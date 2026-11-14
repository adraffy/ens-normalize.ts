// Decoder for the payloads produced by scripts/encoder.ts:
// an adaptive binary range coder over base-90 digits,
// with integers binarized as context-modeled Exp-Golomb.

const RADIX = 90;
const BOT = RADIX ** 4; // renormalize below this
const ONE = 4096; // probability scale (12-bit)

export type Reader = {
	/** unsigned int in context `ctx` */
	uint(ctx: number): number;
	/** signed int in context `ctx` */
	sint(ctx: number): number;
	/** sorted set in contexts `ctx`..`ctx+2` */
	set(ctx: number): number[];
};

export function reader(str: string): Reader {
	let pos = 0;
	const digit = () => {
		const c = (str.charCodeAt(pos++) || 35) - 35; // pad with zero
		return c - +(c > 4) - +(c > 57); // skip ' and \
	};
	const probs: number[] = []; // probability of 0, by key
	let range = RADIX * BOT - 1;
	let code = 0;
	for (let i = 0; i < 5; i++) code = code * RADIX + digit();
	const bit = (key: number) => {
		const p = (probs[key] ??= ONE >> 1);
		const bound = Math.floor(range / ONE) * p;
		const b = code >= bound;
		if (b) {
			code -= bound;
			range -= bound;
			probs[key] = p - (p >> 4);
		} else {
			range = bound;
			probs[key] = p + ((ONE - p) >> 4);
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
	// runs: count, then (gap, length-1) pairs
	const set = (ctx: number) => {
		const v: number[] = [];
		for (let runs = uint(ctx), x = 0; runs--; ) {
			x += uint(ctx + 1);
			for (let len = uint(ctx + 2) + 1; len--; ) v.push(x++);
			x++;
		}
		return v;
	};
	return { uint, sint, set };
}

/**
 * Read a sorted table of `cp => cps`, see writeMapped() in scripts/make.ts.
 * Each output is predicted by the previous entry of the same width.
 * Contexts: +0 count, +1 gap, +2..5 width, +6..14 residual, +15..16 derived flag.
 */
export function readMapped(r: Reader, ctx: number, derive?: (cp: number) => number[]): [number, number[]][] {
	const ret: [number, number[]][] = [];
	const prev: number[][] = []; // by width
	for (let n = r.uint(ctx), cp = -1, width = 1, derived = 0; n--; ) {
		cp += 1 + r.uint(ctx + 1);
		if (derive && (derived = r.uint(ctx + 15 + derived))) {
			ret.push([cp, derive(cp)]);
			continue;
		}
		const w = (width = 1 + r.uint(ctx + 1 + Math.min(width, 4)));
		const last = prev[w];
		const cps: number[] = [];
		for (let j = 0; j < w; j++) {
			cps.push((last ? last[j] : cp) + r.sint(ctx + 6 + Math.min(j, 2) + 3 * Math.min(w - 1, 2)));
		}
		ret.push([cp, (prev[w] = cps)]);
	}
	return ret;
}
