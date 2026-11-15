// parity with @adraffy/ens-normalize@1.11.1 (fixture generated from that library)
import { test, expect } from 'bun:test';
import * as lib from '../src/full.ts';
import type { Tokenized } from '../src/full.ts';

// converts the new token shape to the one 1.11.1's ens_tokenize returned
function legacy({ input, tokens }: Tokenized): unknown[] {
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

type Case = { name: string; [k: string]: unknown };
const cases: Case[] = await Bun.file(new URL('./data/api.json', import.meta.url)).json();

const run = (f: () => unknown) => {
	try {
		return f();
	} catch (err) {
		return { error: (err as Error).message };
	}
};
const plain = (v: unknown) =>
	JSON.parse(JSON.stringify(v, (k, x) => (x instanceof Error ? { error: x.message } : (k === 'emoji' && !x) || k === 'restricted' ? undefined : x)));

test(`api parity (${cases.length} names)`, () => {
	for (const c of cases) {
		const { name } = c;
		expect(
			plain({
				name,
				normalize: run(() => lib.ensNormalize(name)),
				beautify: run(() => lib.ensNormalize(name, { beautify: true })),
				fragment: run(() => lib.ensNormalizeFragment(name)),
				fragmentNFD: run(() => lib.ensNormalizeFragment(name, true)),
				split: run(() => lib.ensSplit(name)),
				tokenize: run(() => legacy(lib.ensTokenize(name))),
			}),
		).toEqual(c);
	}
});

test('examples', () => {
	expect(lib.ensNormalize('RaFFY🚴‍♂️.eTh')).toBe('raffy🚴‍♂.eth');
	expect(lib.ensNormalize('1⃣2⃣.eth', { beautify: true })).toBe('1️⃣2️⃣.eth');
	expect(lib.ensNormalize('ξ.eth', { beautify: true })).toBe('Ξ.eth');
	expect(() => lib.ensNormalize('a_b')).toThrow('underscore allowed only at start');
	expect(lib.ensSplit('')).toEqual([]);
	expect(lib.ensEmoji().length).toBeGreaterThan(3000);
	expect(lib.isCombiningMark(0x300)).toBe(true);
	expect(lib.shouldEscape(0x200d)).toBe(true);
	expect(lib.safeStrFromCps([0x300, 0x61, 0x200d])).toBe('◌̀a{200D}');
	expect(lib.nfc([0x65, 0x301])).toEqual([0xe9]);
	expect(lib.nfd([0xe9])).toEqual([0x65, 0x301]);
	expect(lib.ensBuildInfo.unicode).toStartWith('17.0.0');
});

test('restricted', () => {
	const [label] = lib.ensSplit('\u{1104D}\u{1104D}\u{1104D}'); // Brahmi
	expect(label.type).toBe('Restricted[Brah]');
	expect(label.restricted).toBe(true);
	expect(lib.ensSplit('abc')[0].restricted).toBe(false);
	expect(lib.ensSplit('💩')[0].restricted).toBe(false);
	expect(lib.ensSplit('a_b')[0].restricted).toBeUndefined(); // invalid
});

test('label errors keep the original as cause', () => {
	const single = (() => {
		try {
			lib.ensNormalize('a!b');
		} catch (err) {
			return err as Error;
		}
	})()!;
	expect(single.message).toStartWith('disallowed character');
	expect(single.cause).toBeUndefined();
	const multi = (() => {
		try {
			lib.ensNormalize('a!b.eth');
		} catch (err) {
			return err as Error;
		}
	})()!;
	expect(multi.message).toStartWith('Invalid label');
	expect((multi.cause as Error).message).toBe(single.message);
});
