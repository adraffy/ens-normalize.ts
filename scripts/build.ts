// usage: bun scripts/build.ts
import { rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import type { BunPlugin } from 'bun';

const ROOT = new URL('../', import.meta.url).pathname;
const DIST = `${ROOT}dist/`;

// swap embedded NF for String.prototype.normalize()
const nativeNF: BunPlugin = {
	name: 'native-nf',
	setup(build) {
		build.onResolve({ filter: /^\.\/nf\.ts$/ }, () => ({ path: `${ROOT}src/nf-native.ts` }));
	},
};

await rm(DIST, { recursive: true, force: true });

const sizes: [string, number, number][] = [];
for (const [name, plugins] of [
	['index', []],
	['xnf', [nativeNF]],
] as const) {
	for (const [format, ext] of [
		['esm', 'js'],
		['cjs', 'cjs'],
	] as const) {
		const out = await Bun.build({
			entrypoints: [`${ROOT}src/index.ts`],
			format,
			target: 'browser',
			minify: true,
			plugins: [...plugins],
		});
		if (!out.success) throw new AggregateError(out.logs, 'build failed');
		const code = await out.outputs[0].text();
		await Bun.write(`${DIST}${name}.${ext}`, code);
		sizes.push([`${name}.${ext}`, code.length, gzipSync(code, { level: 9 }).length]);
	}
}

const tsc = Bun.spawnSync([process.execPath, 'x', 'tsc', '-p', 'tsconfig.build.json'], { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' });
if (tsc.exitCode) throw new Error('tsc failed');

for (const [file, n, gz] of sizes) console.log(`${file.padEnd(10)} ${String(n).padStart(6)} bytes  ${String(gz).padStart(6)} gzip`);
