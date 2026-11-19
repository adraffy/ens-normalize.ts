// Decoder for the payloads produced by scripts/encoder.ts:
// an adaptive binary range coder over base-93 digits,
// with integers binarized as context-modeled Exp-Golomb.

const RADIX = 93;
const BOT = RADIX ** 4; // renormalize below this
const ONE = 4096; // probability scale (12-bit)

export type Reader = {
	/** unsigned int in context `ctx` */
	uint(ctx: number): number;
	/** signed int in context `ctx` */
	sint(ctx: number): number;
	/** sorted set in contexts `ctx`..`ctx+3` */
	runs(ctx: number): number[];
};

export function reader(str: string): Reader {
	let pos = 0;
	const digit = () => {
		const c = (str.charCodeAt(pos++) || 32) - 32; // pad with zero
		return c - +(c > 7) - +(c > 60); // printable ascii, skipping ' and \
	};
	// probability of 0, by key: average of a fast and a slow adaptive estimate, stored side by side
	// a typed array (rather than filling in a sparse one) keeps the lookups fast; 2^19 slots covers context ids below 128
	const probs = new Uint16Array(1 << 19).fill(ONE >> 1);
	let range = RADIX * BOT - 1;
	let code = 0;
	for (let i = 0; i < 5; i++) code = code * RADIX + digit();
	const bit = (key: number) => {
		const pf = probs[(key *= 2)];
		const ps = probs[key + 1];
		const bound = Math.floor(range / ONE) * ((pf + ps) >> 1);
		const b = code >= bound;
		if (b) {
			code -= bound;
			range -= bound;
			probs[key] = pf - (pf >> 2);
			probs[key + 1] = ps - (ps >> 5);
		} else {
			range = bound;
			probs[key] = pf + ((ONE - pf) >> 2);
			probs[key + 1] = ps + ((ONE - ps) >> 5);
		}
		while (range < BOT) {
			range *= RADIX;
			code = code * RADIX + digit();
		}
		return +b;
	};
	// Exp-Golomb: unary bit-length, then mantissa (top 3 bits as a bit-tree)
	// each context owns 2048 keys: [0,32) unary, [32,544) tree, [544,2048) low bits
	const uint = (ctx: number) => {
		const base = ctx * 2048;
		let n = 0;
		while (bit(base + n)) n++;
		let x = 1;
		for (let i = n; i--; ) x = 2 * x + bit(base + (n - i < 4 ? 32 + n * 16 + x : 544 + n * 32 + i));
		return x - 1;
	};
	const sint = (ctx: number) => {
		const x = uint(ctx);
		return x & 1 ? -(x + 1) / 2 : x / 2;
	};
	// runs: count, then (gap, length-1) pairs; the first gap has its own context
	const runs = (ctx: number) => {
		const v: number[] = [];
		for (let n = uint(ctx), x = 0; n--; ) {
			x += uint(ctx + (x ? 1 : 3));
			for (let len = uint(ctx + 2) + 1; len--; ) v.push(x++);
			x++;
		}
		return v;
	};
	return { uint, sint, runs };
}

/**
 * Read a sorted table of `cp => cps`, see writeMapped() in scripts/make.ts.
 * Gaps between keys don't count the codepoints in `skip`.
 * Each output is predicted by the previous entry of the same width;
 * the first output also moves with the key (same offset as that entry).
 * Contexts: +0 count, +1 gap, +2..5 width, +6..14 residual, +15..16 derived flag.
 */
export function readMapped(r: Reader, ctx: number, derive?: (cp: number) => number[], skip?: Set<number>): [number, number[]][] {
	const ret: [number, number[]][] = [];
	const prev: number[][] = []; // by width: [cp, ...cps]
	for (let n = r.uint(ctx), cp = -1, width = 1, derived = 0; n--; ) {
		let gap = r.uint(ctx + 1) + 1;
		if (skip) while (gap) skip.has(++cp) || gap--;
		else cp += gap; // don't walk every codepoint when there's nothing to skip
		if (derive && (derived = r.uint(ctx + 15 + derived))) {
			ret.push([cp, derive(cp)]);
			continue;
		}
		const w = (width = 1 + r.uint(ctx + 1 + Math.min(width, 4)));
		const last = prev[w];
		const cps: number[] = [];
		for (let j = 0; j < w; j++) {
			cps.push((last ? last[j + 1] + (j ? 0 : cp - last[0]) : cp) + r.sint(ctx + 6 + Math.min(j, 2) + 3 * Math.min(w - 1, 2)));
		}
		prev[w] = [cp, ...cps];
		ret.push([cp, cps]);
	}
	return ret;
}
