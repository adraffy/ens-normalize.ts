// parity with @adraffy/ens-normalize@1.11.1 (fixture generated from that library)
import { test, expect } from 'bun:test';
import * as lib from '../src/full.ts';
import { record } from './parity.ts';

type Case = { name: string; [k: string]: unknown };
const cases: Case[] = await Bun.file(new URL('./fixtures/api-1.11.1.json', import.meta.url)).json();

test(`api parity (${cases.length} names)`, () => {
	for (const c of cases) expect(record(lib, c.name)).toEqual(c as never);
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
