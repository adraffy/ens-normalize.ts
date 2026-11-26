// Fetches the derived spec + tests from ens-normalize-derive (Unicode 18+; ens-normalize.js derived up to 17).
// Pinned to a commit so builds are reproducible: bump DERIVE to update the spec.
//
// usage:
//   bun scripts/download.ts          # fetch missing files
//   bun scripts/download.ts --force  # refetch everything
//   bun scripts/download.ts --labels # also fetch what test/labels.ts needs (about 50 MB)
// make.ts and the test preload call ensureData() automatically.

import { existsSync } from 'node:fs';

const DERIVE = 'dd53241034b9a7b7b0652b45a9e4db9f9499100f'; // adraffy/ens-normalize-derive (Unicode 18)
// ens-normalize.js 1.11.1 (Unicode 17): only test/labels.ts uses it, as the release to compare against
const UPSTREAM = '47d8465c8d69a663dc9a3329d068e6d9e4a5eb3f'; // adraffy/ens-normalize.js
const LABELS = '9e96e2ba97142df523ac9dc386458dec8804d1d9'; // adraffy/ens-labels (2026-10-18, 3,422,100 labels)
const LABELS_SHA256 = '38c7b537db15cebfe38bfcbfe574ad7ac5feb8ec2aa7c2fb5e907bfa50a858b2'; // of labels.json, from its README
const BASE = `https://raw.githubusercontent.com/adraffy/ens-normalize-derive/${DERIVE}/`;
const UPSTREAM_BASE = `https://raw.githubusercontent.com/adraffy/ens-normalize.js/${UPSTREAM}/`;
const ROOT = new URL('../', import.meta.url);

// local path => ens-normalize-derive path
const FILES: Record<string, string> = {
	'data/spec.json': 'output/spec.json',
	'data/nf.json': 'output/nf.json',
	'test/data/tests.json': 'output/tests.json',
	'test/data/nf-tests.json': 'output/nf-tests.json',
};

async function download(local: string, url: string, force: boolean, sha256?: string) {
	const file = new URL(local, ROOT);
	if (!force && existsSync(file)) return;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`download failed: ${url}: ${res.status}`);
	const bytes = await res.bytes();
	if (sha256 && new Bun.CryptoHasher('sha256').update(bytes).digest('hex') !== sha256) throw new Error(`download failed: ${url}: wrong sha256`);
	if (local.endsWith('.json')) JSON.parse(new TextDecoder().decode(bytes)); // sanity check
	await Bun.write(file, bytes);
	console.log(`downloaded ${local} (${bytes.length} bytes)`);
}

export async function ensureData(force = false) {
	await Promise.all(Object.entries(FILES).map(([local, remote]) => download(local, BASE + remote, force)));
}

// for test/labels.ts: every known ENS label, and the released ens-normalize.js (1.11.1, Unicode 17) to compare against
// with a newer spec, the mismatches are the spec's changes (ens-normalize-derive `bun run registrations` explains them)
// labels.json is about 50 MB, so it's only fetched when that script runs
export async function ensureLabels(force = false) {
	await download('test/data/labels.json', `https://raw.githubusercontent.com/adraffy/ens-labels/${LABELS}/labels.json`, force, LABELS_SHA256);
	await download('test/data/ens-normalize.mjs', UPSTREAM_BASE + 'dist/index.mjs', force);
}

if (import.meta.main) {
	const force = process.argv.includes('--force');
	await ensureData(force);
	if (process.argv.includes('--labels')) await ensureLabels(force);
}
