// validates the built bundles (run `bun run build` first)
import { test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

type Test = { name: string; norm?: string; error?: boolean };
const tests: Test[] = (await Bun.file(new URL('./data/tests.json', import.meta.url)).json()).slice(1);
const dist = (f: string) => new URL(`../dist/${f}`, import.meta.url).pathname;

function failures(ensNormalize: (s: string) => string) {
	let n = 0;
	for (const { name, norm = name, error } of tests) {
		let result: string | undefined;
		try {
			result = ensNormalize(name);
		} catch {}
		if (error ? result !== undefined : result !== norm) n++;
	}
	return n;
}

const has = existsSync(dist('index.js'));

test.skipIf(!has)('dist/index.js', async () => {
	expect(failures((await import(dist('index.js'))).ensNormalize)).toBe(0);
});

test.skipIf(!has)('dist/index.cjs', () => {
	expect(failures(createRequire(import.meta.url)(dist('index.cjs')).ensNormalize)).toBe(0);
});

test.skipIf(!has)('dist/full.js', async () => {
	const lib = await import(dist('full.js'));
	expect(failures(lib.ensNormalize)).toBe(0);
	expect(lib.ensTokenize('a\u0300').map((t: { type: string }) => t.type)).toEqual(['nfc']);
});

// native NF depends on the engine's Unicode version, so just report
test.skipIf(!has)('dist/xnf.js', async () => {
	const n = failures((await import(dist('xnf.js'))).ensNormalize);
	console.log(`xnf: ${n} failures (engine Unicode differences)`);
	expect(n).toBeLessThan(tests.length * 0.01);
});
