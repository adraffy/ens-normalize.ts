// Fetches the derived spec + tests from ens-normalize.js.
// Pinned to a commit so builds are reproducible: bump UPSTREAM to update the spec.
//
// usage:
//   bun scripts/download.ts          # fetch missing files
//   bun scripts/download.ts --force  # refetch everything
//   bun scripts/download.ts --labels # also fetch what test/labels.ts needs (about 50 MB)
// make.ts and the test preload call ensureData() automatically.

import { existsSync } from 'node:fs';

const UPSTREAM = '47d8465c8d69a663dc9a3329d068e6d9e4a5eb3f'; // adraffy/ens-normalize.js
const LABELS = '9e96e2ba97142df523ac9dc386458dec8804d1d9'; // adraffy/ens-labels (2026-10-18, 3,422,100 labels)
const LABELS_SHA256 = '38c7b537db15cebfe38bfcbfe574ad7ac5feb8ec2aa7c2fb5e907bfa50a858b2'; // of labels.json, from its README
const BASE = `https://raw.githubusercontent.com/adraffy/ens-normalize.js/${UPSTREAM}/`;
const ROOT = new URL('../', import.meta.url);

// local path => upstream path
const FILES: Record<string, string> = {
	'data/spec.json': 'derive/output/spec.json',
	'data/nf.json': 'derive/output/nf.json',
	'test/data/tests.json': 'validate/tests.json',
	'test/data/nf-tests.json': 'derive/output/nf-tests.json',
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

// for test/labels.ts: every known ENS label, and ens-normalize.js itself (same commit as the spec) to compare against
// labels.json is about 50 MB, so it's only fetched when that script runs
export async function ensureLabels(force = false) {
	await download('test/data/labels.json', `https://raw.githubusercontent.com/adraffy/ens-labels/${LABELS}/labels.json`, force, LABELS_SHA256);
	await download('test/data/ens-normalize.mjs', BASE + 'dist/index.mjs', force);
}

if (import.meta.main) {
	const force = process.argv.includes('--force');
	await ensureData(force);
	if (process.argv.includes('--labels')) await ensureLabels(force);
}
