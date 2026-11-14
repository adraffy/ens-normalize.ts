// Builds src/generated/*.ts from data/spec.json + data/nf.json
// usage: bun scripts/make.ts

import { createHash } from 'node:crypto';
import { Encoder } from './encoder.ts';
import { reader } from '../src/decoder.ts';
import { Ctx } from '../src/contexts.ts';

const ROOT = new URL('../', import.meta.url);
const specBytes = await Bun.file(new URL('data/spec.json', ROOT)).bytes();
const nfBytes = await Bun.file(new URL('data/nf.json', ROOT)).bytes();
const spec = JSON.parse(new TextDecoder().decode(specBytes));
const nf = JSON.parse(new TextDecoder().decode(nfBytes));

type Mapped = [number, number[]][];

function sha256(v: Uint8Array) {
	return createHash('sha256').update(v).digest('hex');
}

// track per-section sizes
class Sections {
	sizes: [string, number][] = [];
	private prev = 0;
	constructor(readonly enc: Encoder) {}
	mark(name: string) {
		const bits = [...this.enc.cost.values()].reduce((a, b) => a + b, 0);
		this.sizes.push([name, Math.round((bits - this.prev) / Math.log2(90))]);
		this.prev = bits;
	}
}

// ************************************************************
// shared: mapped table
// contexts: c+0 count, c+1 gap, c+2..c+5 width, c+6..c+14 residual, c+15..c+16 derive flag
function writeMapped(enc: Encoder, c: number, mapped: Mapped, derive?: (x: number) => number[] | undefined) {
	mapped = mapped.toSorted((a, b) => a[0] - b[0]);
	enc.uint(c, mapped.length);
	let px = -1;
	let pw = 1;
	let pd = 0;
	const last: Mapped = [];
	for (const [x, ys] of mapped) {
		enc.uint(c + 1, x - px - 1);
		px = x;
		if (derive) {
			const d = derive(x);
			const flag = d && d.length === ys.length && d.every((y, i) => y === ys[i]) ? 1 : 0;
			enc.uint(c + 15 + pd, flag);
			pd = flag;
			if (flag) continue;
		}
		const w = ys.length;
		enc.uint(c + 1 + Math.min(pw, 4), w - 1);
		pw = w;
		const prev = last[w]?.[1];
		for (let j = 0; j < w; j++) {
			enc.sint(c + 6 + Math.min(j, 2) + 3 * Math.min(w - 1, 2), ys[j] - (prev ? prev[j] : x));
		}
		last[w] = [x, ys];
	}
}

// ************************************************************
// NF

function encodeNF() {
	const enc = new Encoder();
	const sec = new Sections(enc);
	const { ranks, exclusions, decomp } = nf as { ranks: number[][]; exclusions: number[]; decomp: Mapped };
	enc.uint(Ctx.RANK_COUNT, ranks.length);
	for (const v of ranks) enc.set(Ctx.RANK, v);
	sec.mark('ranks');
	enc.set(Ctx.EXCLUSIONS, exclusions);
	sec.mark('exclusions');
	if (decomp.some(([, ys]) => ys.length > 2)) throw new Error('expected decomp width <= 2');
	writeMapped(enc, Ctx.DECOMP, decomp);
	sec.mark('decomp');
	return { enc, sec };
}

// ************************************************************
// ENS

// full canonical decomposition (no reordering needed for derive check)
const DECOMP = new Map<number, number[]>(nf.decomp);
const fullDecomp = (x: number): number[] => {
	const v = DECOMP.get(x);
	return v ? v.flatMap(fullDecomp) : [x];
};

function findSharedChunks(groups: number[][], minOverlap = 0.9, minSize = 256) {
	const union = new Set<number>();
	const shared = new Set<number>();
	for (const cps of groups) {
		for (const cp of cps) (union.has(cp) ? shared : union).add(cp);
	}
	const chunks: number[][] = [];
	while (true) {
		groups = groups.map((cps) => cps.filter((cp) => shared.has(cp))).filter((cps) => cps.length);
		if (groups.length <= 1) break;
		groups.sort((a, b) => b.length - a.length);
		const share = [0];
		let set0 = new Set(groups[0]);
		for (let i = 1; i < groups.length; i++) {
			const set = groups[i].filter((cp) => set0.has(cp));
			if (set.length / set0.size >= minOverlap) {
				set0 = new Set(set);
				share.push(i);
			}
		}
		for (const i of share) groups[i] = groups[i].filter((cp) => !set0.has(cp));
		if (set0.size >= minSize) chunks.push([...set0]);
	}
	return chunks;
}

class TrieNode {
	branches: Record<string, TrieNode> = {};
	valid?: boolean;
	save?: boolean;
	check?: boolean;
	get size(): number {
		return Object.values(this.branches).reduce((a, x) => a + 1 + x.size, 0);
	}
	add(cp: number) {
		return (this.branches[cp] ??= new TrieNode());
	}
	scan(fn: (node: TrieNode, path: [string, TrieNode][]) => void, path: [string, TrieNode][] = []) {
		fn(this, path);
		for (const [k, node] of Object.entries(this.branches)) node.scan(fn, [...path, [k, node]]);
	}
	collapseNodes(memo: Record<string, TrieNode> = {}) {
		for (const [k, node] of Object.entries(this.branches)) {
			node.collapseNodes(memo);
			const key = JSON.stringify(node);
			const dup = memo[key];
			if (dup) {
				this.branches[k] = dup;
			} else {
				memo[key] = node;
			}
		}
	}
	collapseKeys() {
		let m = Object.entries(this.branches);
		const u: Record<string, TrieNode> = (this.branches = {});
		while (m.length) {
			const [key, node] = m.pop()!;
			u[[...m.filter((kv) => kv[1] === node).map((kv) => kv[0]), key].sort().join()] = node;
			m = m.filter((kv) => kv[1] !== node);
			node.collapseKeys();
		}
	}
}

function encodeENS() {
	const enc = new Encoder();
	const sec = new Sections(enc);
	const { mapped, ignored, emoji, cm, nsm, wholes, groups, escape, nfc_check } = spec as {
		mapped: Mapped;
		ignored: number[];
		emoji: number[][];
		cm: number[];
		nsm: number[];
		wholes: { valid: number[]; confused: number[] }[];
		groups: { name: string; restricted?: boolean; primary: number[]; secondary: number[]; cm: unknown }[];
		escape: number[];
		nfc_check: number[];
	};

	writeMapped(enc, Ctx.MAPPED, mapped, fullDecomp);
	sec.mark('mapped');
	enc.set(Ctx.IGNORED, ignored);
	sec.mark('ignored');
	enc.set(Ctx.CM, cm);
	sec.mark('cm');
	enc.set(Ctx.NSM, nsm.map((x) => cm.indexOf(x)));
	sec.mark('nsm');
	enc.set(Ctx.ESCAPE, escape);
	sec.mark('escape');
	enc.set(Ctx.NFC_CHECK, nfc_check);
	sec.mark('nfc_check');

	// groups
	if (groups.some((g) => Array.isArray(g.cm) && g.cm.length)) throw new Error('expected no complex CM sequences');
	const chunks = findSharedChunks(groups.flatMap((g) => [g.primary, g.secondary]));
	enc.uint(Ctx.CHUNK_COUNT, chunks.length);
	for (const v of chunks) enc.set(Ctx.CHUNK, v);
	const unrestricted = groups.findIndex((g) => g.restricted);
	if (groups.slice(unrestricted).some((g) => !g.restricted)) throw new Error('expected restricted groups last');
	enc.uint(Ctx.UNRESTRICTED, unrestricted);
	for (const g of groups) {
		if (!/^[A-Z][a-z]+$/.test(g.name)) throw new Error(`unexpected group name: ${g.name}`);
		// name: lowercase letters (a=1) in contexts by position, 0 terminated
		const name = [...g.name.toLowerCase()].map((ch) => ch.charCodeAt(0) - 0x60);
		name.forEach((x, i) => enc.uint(Ctx.GROUP_NAME + Math.min(i, 4), x));
		enc.uint(Ctx.GROUP_NAME + Math.min(name.length, 4), 0);
		for (const [i, v] of [g.primary, g.secondary].entries()) {
			const set = new Set(v);
			const parts: number[] = [];
			chunks.forEach((chunk, j) => {
				if (chunk.every((cp) => set.has(cp))) {
					parts.push(j);
					for (const cp of chunk) set.delete(cp);
				}
			});
			enc.set((i ? Ctx.GROUP_SECONDARY : Ctx.GROUP_PRIMARY), parts);
			enc.set((i ? Ctx.GROUP_SECONDARY : Ctx.GROUP_PRIMARY) + 3, set);
		}
		enc.uint(Ctx.GROUP_NSM, Array.isArray(g.cm) ? 0 : 1); // 1 = check NSM
	}
	enc.uint(Ctx.GROUP_NAME, 0); // empty name = end
	sec.mark('groups');

	// wholes: union of valid, union of confused, then back-refs over the sorted union
	type Flat = { cp: number; w: object; valid?: boolean };
	const flat: Flat[] = wholes
		.flatMap((w) => [...w.valid.map((cp) => ({ cp, w, valid: true })), ...w.confused.map((cp) => ({ cp, w }))])
		.sort((a, b) => a.cp - b.cp);
	enc.set(Ctx.WHOLE_VALID, flat.filter((f) => f.valid).map((f) => f.cp));
	enc.set(Ctx.WHOLE_CONFUSED, flat.filter((f) => !f.valid).map((f) => f.cp));
	const lastIndex = new Map<object, number>();
	flat.forEach((f, i) => {
		const j = lastIndex.get(f.w);
		enc.uint(Ctx.WHOLE_LINK, j === undefined ? 0 : i - j);
		lastIndex.set(f.w, i);
	});
	sec.mark('wholes');

	// emoji
	if (emoji.some((v) => v.length < 2)) throw new Error('expected no solo emoji');
	const root = new TrieNode();
	for (const cps of emoji) {
		let node = root;
		for (const cp of cps) node = node.add(cp);
		node.valid = true;
	}
	// sequences of the form: a MOD b MOD2 c where MOD != MOD2
	// remember the first modifier so the second can be non-exclusionary
	const MODS = new Set(['127995', '127996', '127997', '127998', '127999']); // 1F3FB..1F3FF
	root.scan((node, path) => {
		const v = Object.keys(node.branches);
		if (v.length !== MODS.size - 1 || !v.every((k) => MODS.has(k))) return;
		const m = path.filter((kv) => MODS.has(kv[0]));
		if (!m.length) return;
		for (const cp of MODS) {
			if (!node.branches[cp]) {
				node.branches[cp] = node.branches[v[0]];
				break;
			}
		}
		m[m.length - 1][1].save = true;
		for (const b of Object.values(node.branches)) b.check = true;
	});
	const before = root.size;
	root.collapseNodes();
	root.collapseKeys();
	console.log(`Emoji trie: ${before} => ${root.size} nodes`);
	const sorted = [...new Set(emoji.flat())].sort((a, b) => a - b);
	const index = new Map(sorted.map((x, i) => [x, i]));
	enc.set(Ctx.EMOJI_CPS, sorted);
	const writeEmoji = (node: TrieNode) => {
		enc.uint(Ctx.EMOJI_STATE, (node.valid ? 1 : 0) | (node.save ? 2 : 0) | (node.check ? 4 : 0));
		for (const [keys, x] of Object.entries(node.branches)) {
			enc.set(Ctx.EMOJI_BRANCH, keys.split(',').map((k) => index.get(+k)!));
			writeEmoji(x);
		}
		enc.set(Ctx.EMOJI_BRANCH, []);
	};
	writeEmoji(root);
	sec.mark('emoji');
	return { enc, sec };
}

// ************************************************************
// output

function finish(name: string, { enc, sec }: { enc: Encoder; sec: Sections }) {
	const log = enc.log.slice();
	const str = enc.finish();
	// verify: replay every symbol through the real decoder
	if (process.env.NOVERIFY) return console.log(`${name}: ${str.length}`), str;
	const r = reader(str);
	for (const [c, x] of log) {
		const y = r.uint(c);
		if (x !== y) throw new Error(`${name}: decode mismatch ctx=${c}: ${x} vs ${y}`);
	}
	console.log(`${name}: ${str.length} chars, ${log.length} symbols`);
	if (process.env.COST) console.log([...enc.cost].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${Math.round(v / Math.log2(90))}`).join(" "));
	for (const [k, n] of sec.sizes) console.log(`  ${k.padEnd(12)} ${n}`);
	return str;
}

const NF = finish('NF', encodeNF());
const ENS = finish('ENS', encodeENS());

const header = (src: string) =>
	[`// generated by scripts/make.ts from ${src}`, `// do not edit`].join('\n');

const OUT = new URL('src/generated/', ROOT);
await Bun.write(
	new URL('nf.ts', OUT),
	[header('data/nf.json'), `// sha256: ${sha256(nfBytes)}`, `export default '${NF}';`, ''].join('\n'),
);
await Bun.write(
	new URL('ens.ts', OUT),
	[
		header('data/spec.json'),
		`// sha256: ${sha256(specBytes)}`,
		`export default '${ENS}';`,
		`export const FENCED: Map<number, string> = new Map(${JSON.stringify(spec.fenced)});`,
		`export const NSM_MAX = ${spec.nsm_max};`,
		'',
	].join('\n'),
);
await Bun.write(
	new URL('version.ts', OUT),
	[
		header('data/spec.json + data/nf.json'),
		`export const versions = ${JSON.stringify(
			{
				derived: spec.created,
				unicode: spec.unicode,
				cldr: spec.cldr,
				specHash: sha256(specBytes),
				nfHash: sha256(nfBytes),
			},
			null,
			'\t',
		)};`,
		'',
	].join('\n'),
);
