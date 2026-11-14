// parity with @adraffy/ens-normalize@1.11.1 (fixture generated from that library)
import { test, expect } from 'bun:test';
import * as lib from '../src/full.ts';

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
	JSON.parse(JSON.stringify(v, (k, x) => (x instanceof Error ? { error: x.message } : k === 'emoji' && !x ? undefined : x)));

test(`api parity (${cases.length} names)`, () => {
	for (const c of cases) {
		const { name } = c;
		expect(
			plain({
				name,
				normalize: run(() => lib.ensNormalize(name)),
				beautify: run(() => lib.ensBeautify(name)),
				fragment: run(() => lib.ensNormalize(name, { fragment: true })),
				fragmentNFD: run(() => lib.ensNormalize(name, { fragment: 'nfd' })),
				split: run(() => lib.ensSplit(name)),
				tokenize: run(() => lib.ensTokenize(name)),
			}),
		).toEqual(c);
	}
});

test('examples', () => {
	expect(lib.ensNormalize('RaFFY🚴‍♂️.eTh')).toBe('raffy🚴‍♂.eth');
	expect(lib.ensBeautify('1⃣2⃣.eth')).toBe('1️⃣2️⃣.eth');
	expect(lib.ensBeautify('ξ.eth')).toBe('Ξ.eth');
	expect(() => lib.ensNormalize('a_b')).toThrow('underscore allowed only at start');
	expect(lib.ensSplit('')).toEqual([]);
	expect(lib.ensEmoji().length).toBeGreaterThan(3000);
	expect(lib.isCombiningMark(0x300)).toBe(true);
	expect(lib.shouldEscape(0x200d)).toBe(true);
	expect(lib.safeStrFromCps([0x300, 0x61, 0x200d])).toBe('◌̀a{200D}');
	expect(lib.nfc([0x65, 0x301])).toEqual([0xe9]);
	expect(lib.nfd([0xe9])).toEqual([0x65, 0x301]);
	expect(lib.versions.unicode).toStartWith('17.0.0');
});
