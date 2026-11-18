// What a library does with a name, in the shape of ens-normalize.js 1.11.1's output.
// Shared by api.test.ts (against the recorded fixture) and labels.ts (against ens-normalize.js itself).
import type * as Lib from '../src/full.ts';
import type { Tokenized } from '../src/full.ts';

/** the parts of ens-normalize.js that have a counterpart here */
export type Upstream = {
	ens_normalize(name: string): string;
	ens_beautify(name: string): string;
	ens_normalize_fragment(frag: string, decompose?: boolean): string;
	ens_split(name: string, preserve_emoji?: boolean): unknown[];
	ens_tokenize(name: string): unknown[];
};

export type Record = {
	name: string;
	normalize: unknown;
	beautify: unknown;
	fragment: unknown;
	fragmentNFD: unknown;
	split: unknown;
	tokenize: unknown;
};

// converts the new token shape to the one 1.11.1's ens_tokenize returned
export function legacy({ input, tokens }: Tokenized): unknown[] {
	return tokens.map((t) => {
		const cp = input[t.start];
		switch (t.type) {
			case 'stop':
			case 'ignored':
			case 'disallowed':
				return { type: t.type, cp };
			case 'valid':
				return { type: t.type, cps: t.output };
			case 'mapped':
				return { type: t.type, cp, cps: t.output };
			case 'emoji':
				return { type: t.type, emoji: t.beautified, input: input.slice(t.start, t.end), cps: t.output };
			case 'nfc':
				return {
					type: t.type,
					input: t.before.flatMap((p) => (p.type == 'valid' || p.type == 'mapped' ? p.output : [])),
					cps: t.output,
					tokens0: legacy({ input, tokens: t.before }),
					tokens: legacy({ input: t.output, tokens: t.after }),
				};
		}
	});
}

// a thrown error becomes { error: message }
export const run = (f: () => unknown) => {
	try {
		return f();
	} catch (err) {
		return { error: (err as Error).message };
	}
};

// plain JSON, without the fields that deliberately differ (README "Compatibility"):
// `emoji: false` (undefined in 1.11.1) and `restricted` (new here)
export const plain = <T>(v: T): T =>
	JSON.parse(JSON.stringify(v, (k, x) => (x instanceof Error ? { error: x.message } : (k === 'emoji' && !x) || k === 'restricted' ? undefined : x)));

/** record for this library */
export function record(lib: typeof Lib, name: string): Record {
	return plain({
		name,
		normalize: run(() => lib.ensNormalize(name)),
		beautify: run(() => lib.ensNormalize(name, { beautify: true })),
		fragment: run(() => lib.ensNormalizeFragment(name)),
		fragmentNFD: run(() => lib.ensNormalizeFragment(name, true)),
		split: run(() => lib.ensSplit(name)),
		tokenize: run(() => legacy(lib.ensTokenize(name))),
	});
}

/** record for ens-normalize.js */
export function recordUpstream(lib: Upstream, name: string): Record {
	return plain({
		name,
		normalize: run(() => lib.ens_normalize(name)),
		beautify: run(() => lib.ens_beautify(name)),
		fragment: run(() => lib.ens_normalize_fragment(name)),
		fragmentNFD: run(() => lib.ens_normalize_fragment(name, true)),
		split: run(() => lib.ens_split(name)),
		tokenize: run(() => lib.ens_tokenize(name)),
	});
}
