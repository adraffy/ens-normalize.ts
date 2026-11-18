// What a library does with a name, in the shape of ens-normalize.js 1.11.1's output.
// api.test.ts checks it against the recorded fixture; labels.ts uses run() and plain() against ens-normalize.js itself.
import type * as Lib from '../src/full.ts';
import type { Tokenized } from '../src/full.ts';

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
