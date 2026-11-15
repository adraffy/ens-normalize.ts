import { test, expect } from 'bun:test';
import { ensTokenize, ensNormalizeFragment, strFromCps, explodeCp } from '../src/full.ts';

type Test = { name: string };
const tests: Test[] = (await Bun.file(new URL('./data/tests.json', import.meta.url)).json()).slice(1);

test('tokens tile the input and outputs match ensNormalizeFragment', () => {
	const errors: string[] = [];
	for (const { name } of tests) {
		const { input, tokens } = ensTokenize(name);
		if (strFromCps(input) !== name) errors.push(`input: ${name}`);
		let pos = 0;
		for (const t of tokens) {
			if (t.start !== pos || t.end <= t.start) errors.push(`span: ${name}`);
			if (t.type == 'nfc' && (t.parts[0].start !== t.start || t.parts[t.parts.length - 1].end !== t.end)) errors.push(`parts: ${name}`);
			pos = t.end;
		}
		if (pos !== input.length) errors.push(`end: ${name}`);
		if (tokens.some((t) => t.type == 'disallowed')) continue; // ensNormalizeFragment throws
		const output = strFromCps(tokens.flatMap((t) => t.output));
		if (output !== ensNormalizeFragment(name)) errors.push(`output: ${name}`);
	}
	expect(errors.slice(0, 10)).toEqual([]);
});

test('example', () => {
	const { input, tokens } = ensTokenize('A\u0301b💩.');
	expect(input).toEqual(explodeCp('A\u0301b💩.'));
	expect(tokens).toEqual([
		{ type: 'nfc', start: 0, end: 2, output: [0xe1], parts: [
			{ type: 'mapped', start: 0, end: 1, output: [0x61] },
			{ type: 'valid', start: 1, end: 2, output: [0x301] },
		] },
		{ type: 'valid', start: 2, end: 3, output: [0x62] },
		{ type: 'emoji', start: 3, end: 4, output: [0x1f4a9], beautified: [0x1f4a9, 0xfe0f] },
		{ type: 'stop', start: 4, end: 5, output: [0x2e] },
	]);
});
