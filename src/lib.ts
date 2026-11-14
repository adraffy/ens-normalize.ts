// ENSIP-15: ENS Name Normalization
// https://docs.ens.domains/ensip/15

import ENS, { FENCED, NSM_MAX } from './generated/ens.ts';
import { Ctx } from './contexts.ts';
import { reader, readMapped, type Reader } from './decoder.ts';
import { explodeCp, strFromCps, quoteCp, compareArrays } from './utils.ts';
import { nfc, nfd } from './nf.ts';

export { nfc, nfd };

const HYPHEN = 0x2d;
const UNDERSCORE = 0x5f;
const STOP_CH = '.';
const FE0F = 0xfe0f;
const UNIQUE = 1; // confusable placeholder: valid in exactly one group and not confusable

// ************************************************************
// types

/** A label produced by {@link ensSplit}. */
export interface Label {
	/** input codepoints */
	input: number[];
	/** codepoint offset of this label in the name */
	offset: number;
	/** set if the label is invalid */
	error?: Error;
	/** text and emoji tokens */
	tokens?: number[][];
	/** normalized codepoints */
	output?: number[];
	/** label contains emoji */
	emoji?: boolean;
	/** script group: "ASCII", "Emoji", "Latin", "Restricted[Xxxx]", ... */
	type?: string;
}

// ************************************************************
// data

class Group {
	constructor(
		/** display name, eg. "Latin" or "Restricted[Xxxx]" */
		readonly name: string,
		readonly primary: Set<number>,
		readonly secondary: Set<number>,
		/** enforce non-spacing mark rules (not CM-whitelisted) */
		readonly checkNSM: boolean,
	) {}
	has(cp: number) {
		return this.primary.has(cp) || this.secondary.has(cp);
	}
}

/** a run of text (normalized) or a single emoji (styled) */
type OutputToken = { cps: number[]; emoji?: boolean };

type EmojiNode = Map<number, EmojiNode> & { emoji?: number[] };

export let MAPPED: Map<number, number[]>;
export let IGNORED: Set<number>;
let CM: Set<number>;
let NSM: Set<number>;
let ESCAPE: Set<number>;
let GROUPS: Group[];
export let VALID: Set<number>; // possibly valid: union of groups + decomposed parts
let CONFUSABLES: Map<number, Set<Group> | typeof UNIQUE>; // cp => groups outside its confusable extent
let EMOJI_LIST: number[][]; // fully-qualified
let EMOJI_ROOT: EmojiNode;

function addMany<T>(set: Set<T>, v: Iterable<T>) {
	for (const x of v) set.add(x);
}

export function init() {
	if (MAPPED) return;
	const r = reader(ENS);

	// mapped entries flagged as canonical decompositions are derived
	MAPPED = new Map(readMapped(r, Ctx.MAPPED, (cp) => nfd([cp])));
	IGNORED = new Set(r.set(Ctx.IGNORED));
	const cm = r.set(Ctx.CM);
	CM = new Set(cm);
	NSM = new Set(r.set(Ctx.NSM).map((i) => cm[i]));
	ESCAPE = new Set(r.set(Ctx.ESCAPE)); // characters that should not be printed
	GROUPS = readGroups(r);

	// valid = union of groups
	VALID = new Set();
	const multi = new Set<number>(); // valid in 2+ groups
	for (const g of GROUPS) {
		for (const set of [g.primary, g.secondary]) {
			for (const cp of set) (VALID.has(cp) ? multi : VALID).add(cp);
		}
	}

	CONFUSABLES = readConfusables(r);
	for (const cp of VALID) {
		if (!multi.has(cp) && !CONFUSABLES.has(cp)) CONFUSABLES.set(cp, UNIQUE);
	}

	// valid is closed under nfd
	addMany(VALID, nfd(VALID));

	EMOJI_LIST = readEmoji(r).sort(compareArrays);
	EMOJI_ROOT = new Map();
	for (const emoji of EMOJI_LIST) {
		// FE0F is optional, but only where it appears in the fully-qualified sequence
		let nodes = [EMOJI_ROOT];
		for (const cp of emoji) {
			const next = nodes.map((node) => {
				let child = node.get(cp);
				if (!child) node.set(cp, (child = new Map()));
				return child;
			});
			if (cp == FE0F) {
				nodes.push(...next);
			} else {
				nodes = next;
			}
		}
		for (const node of nodes) node.emoji = emoji;
	}
}

function readGroups(r: Reader): Group[] {
	// large shared sets (eg. Han) are stored once as chunks
	const chunks: number[][] = [];
	for (let n = r.uint(Ctx.CHUNK_COUNT); n--; ) chunks.push(r.set(Ctx.CHUNK));
	const readChunked = (c: number) => {
		const set = new Set<number>();
		for (const i of r.set(c)) addMany(set, chunks[i]);
		addMany(set, r.set(c + 3));
		return set;
	};
	const unrestricted = r.uint(Ctx.UNRESTRICTED); // unrestricted groups come first
	const groups: Group[] = [];
	while (true) {
		const letters: number[] = []; // a = 1
		for (let x; (x = r.uint(Ctx.GROUP_NAME + Math.min(letters.length, 4))); ) letters.push(x + 0x60);
		if (!letters.length) return groups;
		letters[0] -= 32; // capitalize
		const name = strFromCps(letters);
		groups.push(
			new Group(
				groups.length < unrestricted ? name : `Restricted[${name}]`,
				readChunked(Ctx.GROUP_PRIMARY),
				readChunked(Ctx.GROUP_SECONDARY),
				!!r.uint(Ctx.GROUP_NSM),
			),
		);
	}
}

// whole-script confusables: for each confused cp, the groups outside its extent
function readConfusables(r: Reader) {
	const ret = new Map<number, Set<Group>>();
	const valid = new Set(r.set(Ctx.WHOLE_VALID));
	// each sorted member links to the previous member of its whole (0 = new whole)
	const wholes: number[][] = [];
	const owner: number[][] = [];
	[...valid, ...r.set(Ctx.WHOLE_CONFUSED)]
		.sort((a, b) => a - b)
		.forEach((cp, i) => {
			const link = r.uint(Ctx.WHOLE_LINK);
			let whole = link ? owner[i - link] : undefined;
			if (!whole) wholes.push((whole = []));
			(owner[i] = whole).push(cp);
		});
	for (const whole of wholes) {
		// connect the groups of each member into extents
		const extents: { groups: Set<Group>; cps: number[] }[] = [];
		for (const cp of whole) {
			const gs = GROUPS.filter((g) => g.has(cp));
			let extent = extents.find(({ groups }) => gs.some((g) => groups.has(g)));
			if (!extent) extents.push((extent = { groups: new Set(), cps: [] }));
			extent.cps.push(cp);
			addMany(extent.groups, gs);
		}
		const union = extents.flatMap(({ groups }) => [...groups]);
		for (const { groups, cps } of extents) {
			const complement = new Set(union.filter((g) => !groups.has(g)));
			for (const cp of cps) if (!valid.has(cp)) ret.set(cp, complement);
		}
	}
	return ret;
}

// see writeEmoji() in scripts/make.ts
function readEmoji(r: Reader): number[][] {
	type Node = { state: number; branches: Node[]; cps: number[] };
	const ret: number[][] = [];
	const sorted = r.set(Ctx.EMOJI_CPS);
	const read = (cps: number[]): Node => {
		const state = r.uint(Ctx.EMOJI_STATE); // 1 = valid, 2 = save modifier, 4 = check modifier
		const branches: Node[] = [];
		for (let v; (v = r.set(Ctx.EMOJI_BRANCH)).length; ) branches.push(read(v.map((i) => sorted[i])));
		return { state, branches, cps };
	};
	const expand = ({ state, branches }: Node, path: number[], saved?: number) => {
		const last = path[path.length - 1];
		if (state & 4 && saved === last) return; // same modifier twice
		if (state & 2) saved = last;
		if (state & 1) ret.push(path);
		for (const br of branches) for (const cp of br.cps) expand(br, [...path, cp], saved);
	};
	expand(read([]), []);
	return ret;
}

// ************************************************************
// errors

// if escaped: {HEX}
//       else: "x" {HEX}
function quotedCp(cp: number): string {
	return (shouldEscape(cp) ? '' : `${bidiQQ(safeStrFromCps([cp]))} `) + quoteCp(cp);
}

// some messages can be mixed-directional and result in spillover
// use 200E after a quoted string to force the remainder of a string from
// acquring the direction of the quote
// https://www.w3.org/International/questions/qa-bidi-unicode-controls#exceptions
function bidiQQ(s: string): string {
	return `"${s}"‎`;
}

const errorPlacement = (where: string) => new Error(`illegal placement: ${where}`);
const errorDisallowed = (cp: number) => new Error(`disallowed character: ${quotedCp(cp)}`);

function errorMixture(g: Group, cp: number): Error {
	let conflict = quotedCp(cp);
	const other = GROUPS.find((g) => g.primary.has(cp)); // only check primary
	if (other) conflict = `${other.name} ${conflict}`;
	return new Error(`illegal mixture: ${g.name} + ${conflict}`);
}

// ************************************************************
// public

/**
 * Create a safe to print string:
 * invisibles are escaped, leading CM uses a placeholder,
 * and if cps exceed max, the middle is truncated with an ellipsis.
 * (in HTML, call this then replace [<>&] with entities)
 */
export function safeStrFromCps(cps: readonly number[], max = Infinity, quoter: (cp: number) => string = quoteCp): string {
	const buf: string[] = [];
	if (isCombiningMark(cps[0])) buf.push('◌');
	if (cps.length > max) {
		max >>= 1;
		cps = [...cps.slice(0, max), 0x2026, ...cps.slice(-max)];
	}
	let prev = 0;
	const n = cps.length;
	for (let i = 0; i < n; i++) {
		const cp = cps[i];
		if (shouldEscape(cp)) {
			buf.push(strFromCps(cps.slice(prev, i)), quoter(cp));
			prev = i + 1;
		}
	}
	buf.push(strFromCps(cps.slice(prev, n)));
	return buf.join('');
}

/** true if `cp` is a combining mark (or only a non-spacing mark, if `onlyNSM`) */
export function isCombiningMark(cp: number, onlyNSM?: boolean): boolean {
	init();
	return (onlyNSM ? NSM : CM).has(cp);
}

/** true if `cp` should be escaped when printed */
export function shouldEscape(cp: number): boolean {
	init();
	return ESCAPE.has(cp);
}

/** all supported emoji, fully-qualified, ordered by length then lexicographically */
export function ensEmoji(): number[][] {
	init();
	return EMOJI_LIST.map((x) => [...x]);
}

/** normalize without validation (for partial input), optionally NFD */
export function ensNormalizeFragment(frag: string, decompose?: boolean): string {
	init();
	const nf = decompose ? nfd : nfc;
	return frag
		.split(STOP_CH)
		.map((label) => strFromCps(outputTokenize(explodeCp(label), nf, filterFE0F).flatMap((t) => t.cps)))
		.join(STOP_CH);
}

/** normalize a name or throw */
export function ensNormalize(name: string): string {
	return flatten(split(name, nfc, filterFE0F));
}

/** normalize a name for display (preserves emoji presentation, uses Ξ) or throw */
export function ensBeautify(name: string): string {
	const labels = split(name, nfc, (x) => x);
	for (const { type, output, error } of labels) {
		if (error) break; // flatten will throw
		// update ethereum symbol: ξ => Ξ if not greek
		if (type !== 'Greek') {
			for (let i = 0; i < output!.length; i++) if (output![i] == 0x3be) output![i] = 0x39e;
		}
	}
	return flatten(labels);
}

/** split a name into labels with details (does not throw) */
export function ensSplit(name: string, preserveEmoji?: boolean): Label[] {
	return split(name, nfc, preserveEmoji ? (x) => x.slice() : filterFE0F);
}

type NF = (cps: number[]) => number[];
type EmojiStyler = (emoji: number[]) => number[];

function split(name: string, nf: NF, styler: EmojiStyler): Label[] {
	if (!name) return []; // empty name allowance
	init();
	let offset = 0;
	// https://unicode.org/reports/tr46/#Validity_Criteria
	// 4.) "The label must not contain a U+002E ( . ) FULL STOP."
	return name.split(STOP_CH).map((label) => {
		const input = explodeCp(label);
		const info: Label = { input, offset };
		offset += input.length + 1; // + stop
		try {
			// 1.) "The label must be in Unicode Normalization Form NFC"
			const tokens = outputTokenize(input, nf, styler);
			const parts = (info.tokens = tokens.map((t) => t.cps));
			if (!tokens.length) throw new Error('empty label'); // could of had ignored characters
			const norm = (info.output = parts.flat());
			checkLeadingUnderscore(norm);
			info.type = checkValid(tokens, norm, (info.emoji = tokens.length > 1 || !!tokens[0].emoji));
		} catch (err) {
			info.error = err as Error;
		}
		return info;
	});
}

// returns the label type
function checkValid(tokens: OutputToken[], norm: number[], emoji: boolean): string {
	if (!emoji && norm.every((cp) => cp < 0x80)) {
		// fast path: ascii cant have fenced, cm, or wholes
		checkLabelExtension(norm);
		return 'ASCII';
	}
	const chars = tokens.flatMap((t) => (t.emoji ? [] : t.cps)); // all of the text, concatenated
	if (!chars.length) return 'Emoji';
	checkCombiningMarks(tokens);
	checkFenced(norm);
	const unique = [...new Set(chars)];
	const group = determineGroup(unique);
	checkGroup(group, chars); // need text in order
	checkWhole(group, unique); // only need unique text
	return group.name;
}

// assumption: ascii
function checkLabelExtension(cps: number[]) {
	if (cps.length >= 4 && cps[2] == HYPHEN && cps[3] == HYPHEN) {
		throw new Error(`invalid label extension: "${strFromCps(cps.slice(0, 4))}"`);
	}
}

function checkLeadingUnderscore(cps: number[]) {
	for (let i = cps.lastIndexOf(UNDERSCORE); i > 0; ) {
		if (cps[--i] !== UNDERSCORE) throw new Error('underscore allowed only at start');
	}
}

// 5.) "The label must not begin with a combining mark, that is: General_Category=Mark."
// text tokens are separated by emoji, so a non-leading CM must follow an emoji
function checkCombiningMarks(tokens: OutputToken[]) {
	tokens.forEach(({ cps, emoji }, i) => {
		if (!emoji && CM.has(cps[0])) {
			throw errorPlacement(i ? `emoji + combining mark: "${strFromCps(tokens[i - 1].cps)} + ${safeStrFromCps([cps[0]])}"` : 'leading combining mark');
		}
	});
}

// check that a fenced cp is not leading, trailing, or touching another fenced cp
function checkFenced(cps: number[]) {
	let prev = FENCED.get(cps[0]);
	if (prev) throw errorPlacement(`leading ${prev}`);
	const n = cps.length;
	let last = -1; // prevents trailing from throwing
	for (let i = 1; i < n; i++) {
		const name = FENCED.get(cps[i]);
		if (name) {
			// since cps[0] isn't fenced, cps[1] cannot throw
			if (last == i) throw errorPlacement(`${prev} + ${name}`);
			last = i + 1;
			prev = name;
		}
	}
	if (last == n) throw errorPlacement(`trailing ${prev}`);
}

// returns the highest priority group that contains every cp
function determineGroup(unique: number[]): Group {
	let groups = GROUPS;
	for (const cp of unique) {
		const gs = groups.filter((g) => g.has(cp));
		if (!gs.length) {
			if (!GROUPS.some((g) => g.has(cp))) {
				// the character was composed of valid parts but its NFC form is invalid
				throw errorDisallowed(cp);
			}
			// there is no group that contains all these characters
			// https://www.unicode.org/reports/tr39/#mixed_script_confusables
			throw errorMixture(groups[0], cp);
		}
		groups = gs;
		if (gs.length == 1) break; // there is only one group left
	}
	return groups[0];
}

// assumption: cps.length > 0 and cps[0] isn't a CM
function checkGroup(g: Group, cps: number[]) {
	for (const cp of cps) {
		if (!g.has(cp)) throw errorMixture(g, cp);
	}
	if (!g.checkNSM) return;
	// https://www.unicode.org/reports/tr39/#Optional_Detection
	const decomposed = nfd(cps);
	for (let i = 1, e = decomposed.length; i < e; i++) {
		if (NSM.has(decomposed[i])) {
			let j = i + 1;
			for (let cp; j < e && NSM.has((cp = decomposed[j])); j++) {
				// a. Forbid sequences of the same nonspacing mark.
				for (let k = i; k < j; k++) {
					if (decomposed[k] == cp) throw new Error(`duplicate non-spacing marks: ${quotedCp(cp)}`);
				}
			}
			// b. Forbid sequences of more than 4 nonspacing marks (gc=Mn or gc=Me).
			const n = j - i;
			if (n > NSM_MAX) {
				throw new Error(`excessive non-spacing marks: ${bidiQQ(safeStrFromCps(decomposed.slice(i - 1, j)))} (${n}/${NSM_MAX})`);
			}
			i = j;
		}
	}
}

function checkWhole(g: Group, unique: number[]) {
	let maker: Group[] | undefined; // groups that could make a confusable whole
	const shared: number[] = [];
	for (const cp of unique) {
		const complement = CONFUSABLES.get(cp);
		if (complement === UNIQUE) return; // unique, non-confusable
		if (complement) {
			maker = maker ? maker.filter((g) => complement.has(g)) : [...complement];
			if (!maker.length) return; // confusable intersection is empty
		} else {
			shared.push(cp);
		}
	}
	// check if any of the remaining groups contain the shared characters too
	for (const other of maker ?? []) {
		if (shared.every((cp) => other.has(cp))) {
			throw new Error(`whole-script confusable: ${g.name}/${other.name}`);
		}
	}
}

// throw on first error
function flatten(labels: Label[]): string {
	return labels
		.map(({ input, error, output }) => {
			if (error) {
				// don't print label again if just a single label
				const msg = error.message;
				throw new Error(labels.length == 1 ? msg : `Invalid label ${bidiQQ(safeStrFromCps(input, 63))}: ${msg}`);
			}
			return strFromCps(output!);
		})
		.join(STOP_CH);
}

// find the longest emoji that starts at `pos`
// returns [emoji, end] or undefined
export function findEmoji(cps: number[], pos: number): [number[], number] | undefined {
	let node: EmojiNode | undefined = EMOJI_ROOT;
	let found: [number[], number] | undefined;
	while (pos < cps.length && (node = node.get(cps[pos++]))) {
		if (node.emoji) found = [node.emoji, pos];
	}
	return found;
}

// returns text and emoji tokens
// eg. "abc💩d" => [{cps: [61, 62, 63]}, {cps: [1F4A9], emoji: true}, {cps: [64]}]
function outputTokenize(cps: number[], nf: NF, styler: EmojiStyler): OutputToken[] {
	const tokens: OutputToken[] = [];
	let buf: number[] = [];
	for (let i = 0; i < cps.length; ) {
		const match = findEmoji(cps, i);
		if (match) {
			if (buf.length) {
				tokens.push({ cps: nf(buf) });
				buf = [];
			}
			tokens.push({ cps: styler(match[0]), emoji: true });
			i = match[1];
		} else {
			const cp = cps[i++];
			if (VALID.has(cp)) {
				buf.push(cp);
			} else {
				const mapped = MAPPED.get(cp);
				if (mapped) {
					buf.push(...mapped);
				} else if (!IGNORED.has(cp)) {
					throw errorDisallowed(cp);
				}
			}
		}
	}
	if (buf.length) tokens.push({ cps: nf(buf) });
	return tokens;
}

export function filterFE0F(cps: number[]): number[] {
	return cps.filter((cp) => cp != FE0F);
}
