// Adaptive binary range coder (LZMA-style) that emits base-90 digits.
// Integers are binarized as Exp-Golomb with context-modeled bits.
// This file must stay in sync with src/decoder.ts.

export const RADIX = 90;
export const TOP = RADIX ** 5; // range upper bound
export const BOT = RADIX ** 4; // renormalize below this
export const PROB_BITS = 12;
export const PROB_ONE = 1 << PROB_BITS;
export const SHIFT = 4; // adaptation rate (must match decoder)
export const CTX = 2048; // probability slots per integer context
export const TREE = 3; // top mantissa bits modeled as a bit-tree (must match decoder)

// digit d => printable ascii, skipping ' and \
export function charFromDigit(d: number): string {
	let c = d + (d >= 4 ? 1 : 0);
	if (c >= 57) c++;
	return String.fromCharCode(35 + c);
}

export class Encoder {
	private low = 0;
	private range = TOP - 1;
	private cache = 0;
	private cacheSize = 1;
	private digits: number[] = [];
	private probs = new Map<number, number>();
	symbols = 0;
	cost = new Map<number, number>(); // bits per context
	log: [number, number][] = []; // (ctx, value) for verification
	private ctx = 0;

	private shiftLow() {
		const { low } = this;
		if (low < (RADIX - 1) * BOT || low >= TOP) {
			const carry = low >= TOP ? 1 : 0;
			this.digits.push(this.cache + carry);
			for (; this.cacheSize > 1; this.cacheSize--) this.digits.push((RADIX - 1 + carry) % RADIX);
			this.cacheSize = 0;
			this.cache = Math.floor((low % TOP) / BOT);
		}
		this.cacheSize++;
		this.low = (low % BOT) * RADIX;
	}

	bit(key: number, b: number | boolean) {
		const p = this.probs.get(key) ?? PROB_ONE >> 1;
		const bound = Math.floor(this.range / PROB_ONE) * p;
		this.cost.set(this.ctx, (this.cost.get(this.ctx) ?? 0) - Math.log2(b ? 1 - p / PROB_ONE : p / PROB_ONE));
		if (b) {
			this.low += bound;
			this.range -= bound;
			this.probs.set(key, p - (p >> SHIFT));
		} else {
			this.range = bound;
			this.probs.set(key, p + ((PROB_ONE - p) >> SHIFT));
		}
		while (this.range < BOT) {
			this.range *= RADIX;
			this.shiftLow();
		}
	}

	// unsigned integer in context c
	uint(c: number, x: number) {
		if (!Number.isSafeInteger(x) || x < 0) throw new TypeError(`expected unsigned: ${x}`);
		this.symbols++;
		this.ctx = c;
		this.log.push([c, x]);
		c *= CTX;
		const v = x + 1;
		const n = Math.floor(Math.log2(v));
		if (2 ** n > v || 2 ** (n + 1) <= v) throw new Error('log2');
		for (let i = 0; i < n; i++) this.bit(c + i, 1);
		this.bit(c + n, 0);
		let node = 1;
		for (let i = n; i--; ) {
			const b = Math.floor(v / 2 ** i) & 1;
			this.bit(n - i <= TREE ? c + 32 + n * 16 + node : c + 544 + n * 32 + i, b);
			node = node * 2 + b;
		}
	}

	// signed integer (zigzag)
	sint(c: number, x: number) {
		this.uint(c, x < 0 ? -2 * x - 1 : 2 * x);
	}

	// sorted unique set as runs: count, then (gap, length-1) pairs
	// uses contexts c, c+1, c+2
	set(c: number, values: Iterable<number>) {
		const v = [...new Set(values)].sort((a, b) => a - b);
		const runs: [number, number][] = [];
		for (const x of v) {
			const last = runs[runs.length - 1];
			if (last && last[0] + last[1] === x) {
				last[1]++;
			} else {
				runs.push([x, 1]);
			}
		}
		this.uint(c, runs.length);
		let prev = 0;
		for (const [x, n] of runs) {
			this.uint(c + 1, x - prev);
			this.uint(c + 2, n - 1);
			prev = x + n + 1; // runs are separated by at least 1
		}
	}

	finish(): string {
		for (let i = 0; i < 6; i++) this.shiftLow();
		const d = this.digits;
		if (d[0] !== 0) throw new Error('expected leading zero digit');
		d.shift();
		while (d.length && d[d.length - 1] === 0) d.pop(); // decoder pads with zeros
		return d.map(charFromDigit).join('');
	}
}
