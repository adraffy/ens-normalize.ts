import { test, expect } from 'bun:test';
import { nfc, nfd } from '../src/lib.ts';
import { explodeCp, strFromCps } from '../src/utils.ts';

const tests: Record<string, [string, string, string][]> = await Bun.file(new URL('./data/nf-tests.json', import.meta.url)).json();

for (const [section, cases] of Object.entries(tests)) {
	test(`nf: ${section} (${cases.length})`, () => {
		const errors: string[] = [];
		for (const [input, nfd0, nfc0] of cases) {
			const cps = explodeCp(input);
			if (strFromCps(nfd(cps)) !== nfd0) errors.push(`nfd ${input}`);
			if (strFromCps(nfc(cps)) !== nfc0) errors.push(`nfc ${input}`);
		}
		expect(errors).toEqual([]);
	});
}
