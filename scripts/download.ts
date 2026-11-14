// Fetches the derived spec + tests from ens-normalize.js.
// Pinned to a commit so builds are reproducible: bump UPSTREAM to update the spec.
//
// usage:
//   bun scripts/download.ts          # fetch missing files
//   bun scripts/download.ts --force  # refetch everything
// make.ts and the test preload call ensureData() automatically.

import { existsSync } from 'node:fs';

const UPSTREAM = '47d8465c8d69a663dc9a3329d068e6d9e4a5eb3f'; // adraffy/ens-normalize.js
const BASE = `https://raw.githubusercontent.com/adraffy/ens-normalize.js/${UPSTREAM}/`;
const ROOT = new URL('../', import.meta.url);

// local path => upstream path
const FILES: Record<string, string> = {
	'data/spec.json': 'derive/output/spec.json',
	'data/nf.json': 'derive/output/nf.json',
	'test/data/tests.json': 'validate/tests.json',
	'test/data/nf-tests.json': 'derive/output/nf-tests.json',
};

export async function ensureData(force = false) {
	await Promise.all(
		Object.entries(FILES).map(async ([local, remote]) => {
			const file = new URL(local, ROOT);
			if (!force && existsSync(file)) return;
			const res = await fetch(BASE + remote);
			if (!res.ok) throw new Error(`download failed: ${remote}: ${res.status}`);
			const bytes = await res.bytes();
			JSON.parse(new TextDecoder().decode(bytes)); // sanity check
			await Bun.write(file, bytes);
			console.log(`downloaded ${local} (${bytes.length} bytes)`);
		}),
	);
}

if (import.meta.main) await ensureData(process.argv.includes('--force'));
