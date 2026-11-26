// ENSIP-15: ENS Name Normalization
// https://docs.ens.domains/ensip/15

import ENS, { FENCED, NSM_MAX } from './generated/ens.ts';
import { Ctx } from './contexts.ts';
import { reader, readMapped, type Reader } from './decoder.ts';
import { explodeCp, strFromCps, quoteCp } from './utils.ts';
import { nfc as nfc0, nfd as nfd0, initNF } from './nf.ts';

/** canonical decomposition */
export const nfd = (cps: Iterable<number>): number[] => (init(), nfd0(cps));

/** canonical composition */
export const nfc = (cps: Iterable<number>): number[] => (init(), nfc0(cps));

const HYPHEN = 0x2d;
const UNDERSCORE = 0x5f;
const STOP_CH = '.';
const FE0F = 0xfe0f;
// what checkWhole() remembers about a cp that isn't confusable
const UNIQUE = 1; // valid in exactly one group
const SHARED = 0; // valid in 2+ groups

// ************************************************************
// data

/** what a valid label is: a script group, or ASCII/Emoji */
type LabelType = {
	/** display name: "ASCII", "Emoji", "Latin", "Restricted[Xxxx]", ... */
	typeName: string;
	/** a restricted (excluded or limited-use) script */
	restricted?: boolean;
};

const ASCII: LabelType = { typeName: 'ASCII' };
const EMOJI: LabelType = { typeName: 'Emoji' };

type Group = LabelType & {
	/** primary cps of this group alone */
	own: Set<number>;
	/** all primary cps: `own`, then any shared chunks (which aren't copied) */
	primary: Set<number>[];
	/** every set of the group but `own`: the primary chunks, the secondary cps, and the secondary chunks */
	rest: Set<number>[];
	/** enforce non-spacing mark rules (not CM-whitelisted) */
	checkNSM: boolean;
};

/** a run of text (normalized) or a single emoji (styled) */
export type OutputToken = { cps: number[]; emoji?: boolean };

type EmojiNode = Map<number, EmojiNode> & { emoji?: number[] };

export let MAPPED: Map<number, number[]>;
export let IGNORED: Set<number>;
export let CM: Set<number>;
export let NSM: Set<number>;
let ESCAPE: Set<number>;
let GROUPS: Group[];
export let VALID: Set<number>; // possibly valid: union of groups + decomposed parts
// confused cp => groups outside its confusable extent
// any other cp is filled in on first use by checkWhole(): UNIQUE if it's valid in only one group, else SHARED
let CONFUSABLES: Map<number, Set<Group> | typeof UNIQUE | typeof SHARED> | undefined;
let makeConfusables: () => NonNullable<typeof CONFUSABLES>; // built on first use: only labels that aren't ASCII need it
export let EMOJI_LIST: number[][]; // fully-qualified, unsorted
let EMOJI_ROOT: EmojiNode;

// a plain loop: this is the hot path of group matching, and `for of` or `some()` is measurably slower here
const inAny = (sets: Set<number>[], cp: number) => {
	for (let i = 0; i < sets.length; i++) if (sets[i].has(cp)) return true;
};
// most groups only have `own`
const inGroup = (g: Group, cp: number) => g.own.has(cp) || inAny(g.rest, cp);

function addMany<T>(set: Set<T>, v: Iterable<T>) {
	for (const x of v) set.add(x);
}

export function init() {
	if (MAPPED) return;
	const r = reader(ENS);

	IGNORED = new Set(r.runs(Ctx.IGNORED));
	const cm = r.runs(Ctx.CM);
	CM = new Set(cm);
	initNF(cm); // combining class ranks are stored as indices into cm
	NSM = new Set(r.runs(Ctx.NSM).map((i) => cm[i]));
	ESCAPE = new Set(r.runs(Ctx.ESCAPE)); // characters that should not be printed
	GROUPS = readGroups(r); // also sets VALID to the union of the groups

	// mapped entries flagged as canonical decompositions are derived
	// gaps between mapped cps skip the valid ones
	MAPPED = new Map(readMapped(r, Ctx.MAPPED, (cp) => nfd0([cp]), VALID));

	makeConfusables = readConfusables(r);

	// valid is closed under nfd: add the decomposed parts that aren't valid on their own
	addMany(VALID, r.runs(Ctx.VALID_PARTS));

	EMOJI_LIST = readEmoji(r); // no two emoji differ only by FE0F, so order doesn't matter
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
	// large shared sets (eg. Han) are stored once as chunks, and groups refer to them instead of copying 100K+ cps
	const chunks: Set<number>[] = [];
	VALID = new Set();
	const readSet = (c: number) => {
		const v = r.runs(c);
		addMany(VALID, v);
		return new Set(v);
	};
	for (let n = r.uint(Ctx.CHUNK_COUNT); n--; ) chunks.push(readSet(Ctx.CHUNK));
	// a group's own cps, then the chunks it uses (which are read first)
	const readChunked = (c: number) => {
		const parts = r.runs(c).map((i) => chunks[i]);
		return [readSet(c + 4), ...parts];
	};
	const unrestricted = r.uint(Ctx.UNRESTRICTED); // unrestricted groups come first
	const readName = () => {
		const letters: number[] = []; // a = 1, 0 terminated
		for (let x; (x = r.uint(Ctx.GROUP_NAME + Math.min(letters.length, 4))); ) letters.push(x + 0x60);
		return letters;
	};
	const groups: Group[] = [];
	for (let letters; (letters = readName()).length; ) {
		letters[0] -= 32; // capitalize
		const name = strFromCps(letters);
		const restricted = groups.length >= unrestricted;
		const primary = readChunked(Ctx.GROUP_PRIMARY);
		groups.push({
			typeName: restricted ? `Restricted[${name}]` : name,
			restricted,
			own: primary[0],
			primary,
			rest: [...primary.slice(1), ...readChunked(Ctx.GROUP_SECONDARY)].filter((set) => set.size),
			checkNSM: !!r.uint(Ctx.GROUP_NSM),
		});
	}
	return groups;
}

// whole-script confusables: for each confused cp, the groups outside its extent
// reads the wholes now, and returns a function that works out the extents
function readConfusables(r: Reader): typeof makeConfusables {
	const valid = new Set(r.runs(Ctx.WHOLE_VALID));
	// each sorted member names its whole by recency rank (0 = new whole)
	const wholes: number[][] = []; // most recently used first
	for (const cp of [...valid, ...r.runs(Ctx.WHOLE_CONFUSED)].sort((a, b) => a - b)) {
		const rank = r.uint(Ctx.WHOLE_LINK);
		const whole = rank ? wholes.splice(rank - 1, 1)[0] : [];
		whole.push(cp);
		wholes.unshift(whole);
	}
	return () => {
		const ret: ReturnType<typeof makeConfusables> = new Map();
		for (const whole of wholes) {
			// connect the groups of each member into extents
			const extents: { groupSet: Set<Group>; cps: number[] }[] = [];
			for (const cp of whole) {
				const gs = GROUPS.filter((g) => inGroup(g, cp));
				let extent = extents.find(({ groupSet }) => gs.some((g) => groupSet.has(g)));
				if (!extent) extents.push((extent = { groupSet: new Set(), cps: [] }));
				extent.cps.push(cp);
				addMany(extent.groupSet, gs);
			}
			const union = extents.flatMap(({ groupSet }) => [...groupSet]);
			for (const { groupSet, cps } of extents) {
				const complement = new Set(union.filter((g) => !groupSet.has(g)));
				for (const cp of cps) if (!valid.has(cp)) ret.set(cp, complement);
			}
		}
		return ret;
	};
}

// see writeEmoji() in scripts/make.ts
function readEmoji(r: Reader): number[][] {
	type Node = { bits: number; branches: Node[]; cps: number[] };
	const ret: number[][] = [];
	const sorted = r.runs(Ctx.EMOJI_CPS);
	const read = (cps: number[]): Node => {
		const bits = r.uint(Ctx.EMOJI_STATE); // 1 = valid, 2 = save modifier, 4 = check modifier
		const branches: Node[] = [];
		for (let v; (v = r.runs(Ctx.EMOJI_BRANCH)).length; ) branches.push(read(v.map((i) => sorted[i])));
		return { bits, branches, cps };
	};
	const expand = ({ bits, branches }: Node, path: number[], saved?: number) => {
		const last = path[path.length - 1];
		if (bits & 4 && saved === last) return; // same modifier twice
		if (bits & 2) saved = last;
		if (bits & 1) ret.push(path);
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
	return `"${s}"\u200E`;
}

const errorPlacement = (where: string) => new Error(`illegal placement: ${where}`);
const errorDisallowed = (cp: number) => new Error(`disallowed character: ${quotedCp(cp)}`);

function errorMixture(g: Group, cp: number): Error {
	let conflict = quotedCp(cp);
	const other = GROUPS.find((g) => inAny(g.primary, cp)); // only check primary
	if (other) conflict = `${other.typeName} ${conflict}`;
	return new Error(`illegal mixture: ${g.typeName} + ${conflict}`);
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
	init();
	const buf: string[] = [];
	if (CM.has(cps[0])) buf.push('◌');
	if (cps.length > max) {
		max >>= 1;
		cps = [...cps.slice(0, max), 0x2026, ...cps.slice(-max)];
	}
	let prev = 0;
	const n = cps.length;
	for (let i = 0; i < n; i++) {
		const cp = cps[i];
		if (ESCAPE.has(cp)) {
			buf.push(strFromCps(cps.slice(prev, i)), quoter(cp));
			prev = i + 1;
		}
	}
	buf.push(strFromCps(cps.slice(prev, n)));
	return buf.join('');
}

/** true if `cp` should be escaped when printed */
export function shouldEscape(cp: number): boolean {
	init();
	return ESCAPE.has(cp);
}

export type NormalizeOptions = {
	/**
	 * Return the display form: keeps emoji presentation (FE0F) and uses Ξ for ξ outside Greek.
	 * Validates the same way. Don't hash or store this form.
	 * @default false
	 */
	beautify?: boolean;
};

/**
 * Normalize an ENS name (ENSIP-15).
 * @param name - full name, labels separated by "."; "" returns ""
 * @returns the normalized name (use this for hashing, comparing, and storing)
 * @throws Error if any label is invalid; with 2+ labels the message is prefixed by `Invalid label "…": `
 * @example ensNormalize('Nick.ETH') // "nick.eth"
 * @example ensNormalize('🚴‍♂️.eth', { beautify: true }) // "🚴‍♂️.eth"
 */
export function ensNormalize(name: string, { beautify }: NormalizeOptions = {}): string {
	return beautify
		? transform(name, (emoji) => emoji, (cps, type) => {
				// update ethereum symbol: ξ => Ξ if not greek
				if (type !== 'Greek') for (let i = 0; i < cps.length; i++) if (cps[i] == 0x3be) cps[i] = 0x39e;
			})
		: transform(name, filterFE0F);
}

/**
 * Normalize without validating, for partial input such as search queries and matching.
 * Only throws on disallowed characters.
 * @param decompose - return NFD instead of NFC
 * @example ensNormalizeFragment('ＶＩＴＡ') // "vita"
 */
export function ensNormalizeFragment(frag: string, decompose?: boolean): string {
	init();
	return frag
		.split(STOP_CH)
		.map((label) => strFromCps(flat(outputTokenize(explodeCp(label), filterFE0F, decompose ? nfd0 : nfc0))))
		.join(STOP_CH);
}

// tokenize + validate each label, then join
// errors are prefixed with the label when the name has 2+ labels
function transform(name: string, styler: EmojiStyler, fix?: (cps: number[], type: string) => void): string {
	if (!name) return ''; // empty name allowance
	init();
	const labels = name.split(STOP_CH);
	return labels
		.map((label) => {
			const input = explodeCp(label);
			try {
				const { output, type } = processLabel(input, styler);
				fix?.(output, type);
				return strFromCps(output);
			} catch (err) {
				if (labels.length == 1) throw err;
				throw new Error(`Invalid label ${bidiQQ(safeStrFromCps(input, 63))}: ${(err as Error).message}`, { cause: err });
			}
		})
		.join(STOP_CH);
}

// ************************************************************
// validation

export type EmojiStyler = (emoji: number[]) => number[];

/** the result of each step of processLabel(), see Label in extras.ts */
export type LabelInfo = {
	tokens?: number[][];
	output?: number[];
	emoji?: boolean;
	type?: string;
	restricted?: boolean;
};

export const flat = (tokens: OutputToken[]) => tokens.flatMap((t) => t.cps);

// tokenize and validate one label, throws if invalid
// each step records its result on `info` before the next can throw (ensSplit relies on this)
export function processLabel(input: number[], styler: EmojiStyler, info: LabelInfo = {}): Required<LabelInfo> {
	const tokens = outputTokenize(input, styler);
	info.tokens = tokens.map((t) => t.cps);
	if (!tokens.length) throw new Error('empty label'); // the label could have been only ignored characters
	const norm = (info.output = flat(tokens));
	checkLeadingUnderscore(norm);
	const { typeName, restricted } = checkValid(tokens, norm, (info.emoji = tokens.length > 1 || !!tokens[0].emoji));
	info.type = typeName;
	info.restricted = !!restricted;
	return info as Required<LabelInfo>;
}

function checkLeadingUnderscore(cps: number[]) {
	for (let i = cps.lastIndexOf(UNDERSCORE); i > 0; ) {
		if (cps[--i] !== UNDERSCORE) throw new Error('underscore allowed only at start');
	}
}

// returns the label type
function checkValid(tokens: OutputToken[], norm: number[], emoji: boolean): LabelType {
	if (!emoji && norm.every((cp) => cp < 0x80)) {
		// fast path: ascii cant have fenced, cm, or wholes
		checkLabelExtension(norm);
		return ASCII;
	}
	const chars = tokens.flatMap((t) => (t.emoji ? [] : t.cps)); // all of the text, concatenated
	if (!chars.length) return EMOJI;
	checkCombiningMarks(tokens);
	checkFenced(norm);
	const unique = [...new Set(chars)];
	const group = determineGroup(unique);
	checkGroup(group, chars); // need text in order
	checkWhole(group, unique); // only need unique text
	return group;
}

// assumption: ascii
function checkLabelExtension(cps: number[]) {
	if (cps.length >= 4 && cps[2] == HYPHEN && cps[3] == HYPHEN) {
		throw new Error(`invalid label extension: "${strFromCps(cps.slice(0, 4))}"`);
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
		const gs = groups.filter((g) => inGroup(g, cp));
		if (!gs.length) {
			if (!GROUPS.some((g) => inGroup(g, cp))) {
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
		if (!inGroup(g, cp)) throw errorMixture(g, cp);
	}
	if (!g.checkNSM) return;
	// a combining mark inherits the script of its base (UAX-24): without a CM whitelist, the base must be
	// one of the group's own (primary) cps, not a shared extra (eg. Arabic "-" + U+064B)
	// CM after an emoji was already rejected, so the base is in the same text
	for (let i = 1, base = cps[0]; i < cps.length; i++) {
		const cp = cps[i];
		if (!CM.has(cp)) base = cp;
		else if (!inAny(g.primary, base)) {
			throw errorPlacement(`combining mark on non-${g.typeName}: "${safeStrFromCps([base])} + ${safeStrFromCps([cp])}"`);
		}
	}
	// https://www.unicode.org/reports/tr39/#Optional_Detection
	const decomposed = nfd0(cps);
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
		let complement = (CONFUSABLES ??= makeConfusables()).get(cp);
		if (complement === undefined) {
			// not confusable: remember whether a second group has it (finding out at init for every valid cp is slow)
			CONFUSABLES.set(cp, (complement = GROUPS.filter((g) => inGroup(g, cp))[1] ? SHARED : UNIQUE));
		}
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
		if (shared.every((cp) => inGroup(other, cp))) {
			throw new Error(`whole-script confusable: ${g.typeName}/${other.typeName}`);
		}
	}
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
export function outputTokenize(cps: number[], styler: EmojiStyler, nf = nfc0): OutputToken[] {
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
