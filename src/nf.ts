// Unicode Normalization (NFC/NFD) using embedded data
// so the result is independent of the JS engine's Unicode version.
// https://unicode.org/reports/tr15/

import NF from './generated/nf.ts';
import { Ctx } from './contexts.ts';
import { reader, readMapped } from './decoder.ts';

// algorithmic hangul
// https://www.unicode.org/versions/Unicode15.0.0/ch03.pdf (page 144)
const S0 = 0xac00; // syllables
const S1 = 0xd7a4; // S0 + L_COUNT * N_COUNT
const L0 = 0x1100; // leading
const L1 = 0x1113; // L0 + 19
const V0 = 0x1161; // vowel
const V1 = 0x1176; // V0 + 21
const T0 = 0x11a7; // trailing
const T1 = 0x11c3; // T0 + 28
const T_COUNT = 28;
const N_COUNT = 588; // 21 * 28

const isHangul = (cp: number) => cp >= S0 && cp < S1;

let RANK: Map<number, number>; // cp => combining class rank, pre-shifted (rank << 24)
let DECOMP: Map<number, number[]>; // cp => canonical decomposition
let RECOMP: Map<number, Map<number, number>>; // a => b => composed

function init() {
	const r = reader(NF);
	RANK = new Map();
	for (let i = 1, n = r.uint(Ctx.RANK_COUNT); i <= n; i++) for (const cp of r.set(Ctx.RANK)) RANK.set(cp, i << 24);
	const exclusions = new Set(r.set(Ctx.EXCLUSIONS));
	DECOMP = new Map(readMapped(r, Ctx.DECOMP));
	RECOMP = new Map();
	for (const [cp, [a, b]] of DECOMP) {
		if (b !== undefined && !exclusions.has(cp)) {
			let bucket = RECOMP.get(a);
			if (!bucket) RECOMP.set(a, (bucket = new Map()));
			bucket.set(b, cp);
		}
	}
}

function composePair(a: number, b: number): number {
	if (a >= L0 && a < L1 && b >= V0 && b < V1) {
		return S0 + (a - L0) * N_COUNT + (b - V0) * T_COUNT;
	} else if (isHangul(a) && b > T0 && b < T1 && (a - S0) % T_COUNT == 0) {
		return a + (b - T0);
	} else {
		return RECOMP.get(a)?.get(b) ?? -1;
	}
}

// Streaming pipeline, one codepoint at a time:
//   decompose => reorder => compose (optional) => output
// Canonical reordering only buffers the non-starters after the last starter,
// so nothing holds more than a run of combining marks.
function normalize(cps: Iterable<number>, composing?: boolean): number[] {
	if (!RANK) init();
	const out: number[] = [];
	const marks: number[] = []; // pending non-starters: (rank << 24) | cp
	let starter = -1; // index of the last starter in out
	let prevRank = -1; // rank of the last char after that starter (-1 = adjacent)

	// compose: a char combines with the starter unless blocked
	// by an intervening char of equal or higher rank
	const emit = (packed: number) => {
		const cp = packed & 0xffffff;
		const rank = packed >> 24;
		if (composing && prevRank < rank) {
			const composed = composePair(out[starter], cp);
			if (composed >= 0) {
				out[starter] = composed;
				return;
			}
		}
		if (rank) {
			prevRank = rank;
		} else {
			starter = out.length;
			prevRank = -1;
		}
		out.push(cp);
	};

	// reorder: stable sort each run of non-starters by rank
	const flush = () => {
		if (marks.length > 1) marks.sort((a, b) => (a >> 24) - (b >> 24));
		marks.forEach(emit);
		marks.length = 0;
	};
	const reorder = (cp: number) => {
		const rank = RANK.get(cp);
		if (rank) {
			marks.push(rank | cp);
		} else {
			flush();
			emit(cp);
		}
	};

	// decompose: recursive canonical decomposition + algorithmic hangul
	const decompose = (cp: number): void => {
		if (isHangul(cp)) {
			const s = cp - S0;
			const t = s % T_COUNT;
			reorder(L0 + ((s / N_COUNT) | 0));
			reorder(V0 + (((s % N_COUNT) / T_COUNT) | 0));
			if (t) reorder(T0 + t);
		} else {
			const cps = DECOMP.get(cp);
			if (cps) cps.forEach(decompose);
			else reorder(cp);
		}
	};

	for (const cp of cps) decompose(cp);
	flush();
	return out;
}

/** canonical decomposition */
export function nfd(cps: Iterable<number>): number[] {
	return normalize(cps);
}

/** canonical composition */
export function nfc(cps: Iterable<number>): number[] {
	return normalize(cps, true);
}
