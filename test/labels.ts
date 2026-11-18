// Exhaustive parity check: runs every known ENS label (adraffy/ens-labels, about 3.4M)
// through this library and through ens-normalize.js, and compares every result and error message.
// Not part of `bun test`: it downloads about 50 MB on first run and takes most of a minute.
//
// usage:
//   bun test/labels.ts                # src/full.ts
//   bun test/labels.ts dist/full.js   # a built bundle (core bundles only have normalize + fragment)

import { resolve } from 'node:path';
import { ensureLabels } from '../scripts/download.ts';
import { plain, run } from './parity.ts';
import type * as Lib from '../src/full.ts';

await ensureLabels();

/** the parts of ens-normalize.js compared here (ens_tokenize is left out; api.test.ts covers it against the fixture) */
type Upstream = {
	ens_normalize(name: string): string;
	ens_beautify(name: string): string;
	ens_normalize_fragment(frag: string, decompose?: boolean): string;
	ens_split(name: string, preserve_emoji?: boolean): unknown[];
};

const target = process.argv[2] ?? 'src/full.ts';
const lib: Partial<typeof Lib> & Pick<typeof Lib, 'ensNormalize' | 'ensNormalizeFragment'> = await import(resolve(target));
const upstream: Upstream = await import(new URL('./data/ens-normalize.mjs', import.meta.url).href);
const labels: string[] = await Bun.file(new URL('./data/labels.json', import.meta.url)).json();

// [field, this library, ens-normalize.js]
const { ensSplit } = lib;
const fields: [string, (s: string) => unknown, (s: string) => unknown][] = [
	['normalize', (s) => lib.ensNormalize(s), (s) => upstream.ens_normalize(s)],
	['beautify', (s) => lib.ensNormalize(s, { beautify: true }), (s) => upstream.ens_beautify(s)],
	['fragment', (s) => lib.ensNormalizeFragment(s), (s) => upstream.ens_normalize_fragment(s)],
	['fragmentNFD', (s) => lib.ensNormalizeFragment(s, true), (s) => upstream.ens_normalize_fragment(s, true)],
];
if (ensSplit) fields.push(['split', (s) => ensSplit(s), (s) => upstream.ens_split(s)]);

const short = (v: unknown) => {
	const s = JSON.stringify(v);
	return s.length > 300 ? `${s.slice(0, 300)}… (${s.length} chars)` : s;
};

console.log(`${target} vs ens-normalize.js: ${labels.length} labels, comparing ${fields.map((f) => f[0]).join(', ')}`);
const t0 = performance.now();
const bad = new Map<string, number>(); // field => mismatches
let shown = 0;
let valid = 0;
labels.forEach((label, i) => {
	for (const [field, ours, theirs] of fields) {
		const a = run(() => ours(label));
		const b = run(() => theirs(label));
		if (typeof b === 'string') {
			if (field === 'normalize') valid++;
			if (a === b) continue;
		} else if (Bun.deepEquals(plain(a), plain(b))) {
			continue;
		}
		bad.set(field, (bad.get(field) ?? 0) + 1);
		if (shown++ < 20) console.log(`mismatch: ${field} of ${short(label)}\n  here:     ${short(plain(a))}\n  upstream: ${short(plain(b))}`);
	}
	if ((i + 1) % 500000 == 0) console.log(`  ${i + 1}...`);
});

const total = [...bad.values()].reduce((a, b) => a + b, 0);
console.log(`${labels.length} labels (${valid} valid, ${labels.length - valid} invalid) in ${((performance.now() - t0) / 1000).toFixed(0)}s`);
console.log(total ? `${total} mismatches: ${[...bad].map(([k, n]) => `${k} ${n}`).join(', ')}` : 'no mismatches');
process.exit(total ? 1 : 0);
