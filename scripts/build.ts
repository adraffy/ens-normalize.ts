// usage: bun scripts/build.ts
import { rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import type { BunPlugin } from 'bun';
import { minify } from 'terser';

const ROOT = new URL('../', import.meta.url).pathname;
const DIST = `${ROOT}dist/`;

// swap embedded NF for String.prototype.normalize()
const nativeNF: BunPlugin = {
	name: 'native-nf',
	setup(build) {
		build.onResolve({ filter: /^\.\/nf\.ts$/ }, () => ({ path: `${ROOT}src/nf-native.ts` }));
	},
};

// Property renaming (Bun's minifier doesn't do it).
// core takes { beautify } and returns strings, so every property can be renamed except what crosses the boundary:
// the option, Error's `cause`, and the export names the CJS wrapper defines.
const CORE_PROPS = { reserved: ['beautify', 'cause', 'ensNormalize', 'ensNormalizeFragment', 'exports', '__esModule'] };
// full returns objects (labels, tokens), so only rename properties that never leave the library.
// A name listed here must not also be a public field.
// terser never renames a property that shares its name with a builtin (`name`, `has`, `groups`, `state`, ...),
// which is why internal properties have names like `typeName` and `groupSet`.
const FULL_PROPS = { regex: /^(uint|sint|runs|own|primary|rest|checkNSM|branches|bits|typeName|groupSet)$/ };

await rm(DIST, { recursive: true, force: true });

const sizes: [string, number, number][] = [];
for (const [name, entry, plugins] of [
	['index', 'index', []],
	['xnf', 'index', [nativeNF]],
	['full', 'full', []],
] as const) {
	for (const [format, ext] of [
		['esm', 'js'],
		['cjs', 'cjs'],
	] as const) {
		const out = await Bun.build({
			entrypoints: [`${ROOT}src/${entry}.ts`],
			format,
			target: 'browser',
			minify: true,
			plugins: [...plugins],
		});
		if (!out.success) throw new AggregateError(out.logs, 'build failed');
		// terser after Bun's minifier saves ~2% more
		const { code } = await minify(await out.outputs[0].text(), {
			module: format === 'esm',
			toplevel: true,
			ecma: 2020,
			compress: { passes: 3, unsafe: true, unsafe_arrows: true, pure_getters: true },
			mangle: { properties: entry === 'index' ? CORE_PROPS : FULL_PROPS },
		});
		if (!code) throw new Error('terser failed');
		await Bun.write(`${DIST}${name}.${ext}`, code);
		sizes.push([`${name}.${ext}`, Buffer.byteLength(code), gzipSync(code, { level: 9 }).length]); // bytes, not chars: the bundle has a few non-ASCII literals
	}
}

const tsc = Bun.spawnSync([process.execPath, 'x', 'tsc', '-p', 'tsconfig.build.json'], { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' });
if (tsc.exitCode) throw new Error('tsc failed');

for (const [file, n, gz] of sizes) console.log(`${file.padEnd(10)} ${String(n).padStart(6)} bytes  ${String(gz).padStart(6)} gzip`);
