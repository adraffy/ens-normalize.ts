// Adaptive binary range coder (LZMA-style) that emits base-93 digits.
// Integers are binarized as Exp-Golomb with context-modeled bits.
// This file must stay in sync with src/decoder.ts.

export const RADIX = 93;
export const TOP = RADIX ** 5; // range upper bound
export const BOT = RADIX ** 4; // renormalize below this
export const PROB_BITS = 12;
export const PROB_ONE = 1 << PROB_BITS;
export const FAST = 2; // adaptation rates of the two mixed estimates (must match decoder)
export const SLOW = 5;
export const CTX = 2048; // probability slots per integer context
export const TREE = 3; // top mantissa bits modeled as a bit-tree (must match decoder)

// digit d => printable ascii (0x20..0x7E), skipping ' and \
export function charFromDigit(d: number): string {
	let c = d + (d >= 7 ? 1 : 0);
	if (c >= 60) c++;
	return String.fromCharCode(32 + c);
}

export class Encoder {
	private low = 0;
	private range = TOP - 1;
	private cache = 0;
	private cacheSize = 1;
	private digits: number[] = [];
	private fast = new Map<number, number>();
	private slow = new Map<number, number>();
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

	// probability of 0 = average of a fast and a slow adaptive estimate
	bit(key: number, b: number | boolean) {
		const pf = this.fast.get(key) ?? PROB_ONE >> 1;
		const ps = this.slow.get(key) ?? PROB_ONE >> 1;
		const p = (pf + ps) >> 1;
		const bound = Math.floor(this.range / PROB_ONE) * p;
		this.cost.set(this.ctx, (this.cost.get(this.ctx) ?? 0) - Math.log2(b ? 1 - p / PROB_ONE : p / PROB_ONE));
		if (b) {
			this.low += bound;
			this.range -= bound;
			this.fast.set(key, pf - (pf >> FAST));
			this.slow.set(key, ps - (ps >> SLOW));
		} else {
			this.range = bound;
			this.fast.set(key, pf + ((PROB_ONE - pf) >> FAST));
			this.slow.set(key, ps + ((PROB_ONE - ps) >> SLOW));
		}
		while (this.range < BOT) {
			this.range *= RADIX;
			this.shiftLow();
		}
	}

	// unsigned integer in context c
	uint(c: number, x: number) {
		if (!Number.isSafeInteger(x) || x < 0) throw new TypeError(`expected unsigned: ${x}`);
		if (c >= 128) throw new RangeError(`context id out of range: ${c}`); // the decoder's table has room for 128
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
	// contexts: c count, c+1 gap, c+2 length, c+3 first gap (an absolute position)
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
			this.uint(c + (prev ? 1 : 3), x - prev);
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
