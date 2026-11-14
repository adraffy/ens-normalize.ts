import { test, expect } from 'bun:test';
import { ensNormalize } from '../src/index.ts';

type Test = { name: string; norm?: string; error?: boolean; comment?: string };
const tests: Test[] = await Bun.file(new URL('./data/tests.json', import.meta.url)).json();

test(`ENSIP-15 validation tests (${tests.length})`, () => {
	const errors: object[] = [];
	for (const { name, norm = name, error } of tests.slice(1)) { // first entry is version info
		try {
			const result = ensNormalize(name);
			if (error) errors.push({ type: 'expected error', name, result });
			else if (result !== norm) errors.push({ type: 'wrong norm', name, norm, result });
		} catch (err) {
			if (!error) errors.push({ type: 'unexpected error', name, norm, message: (err as Error).message });
		}
	}
	expect(errors.slice(0, 10)).toEqual([]);
});
