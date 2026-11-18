// Exhaustive parity check of the core API: runs every known ENS label (adraffy/ens-labels, about 3.4M)
// through this library and through ens-normalize.js, and compares every result and error message.
// Not part of `bun test`: it downloads about 50 MB on first run and takes about half a minute.
//
// usage:
//   bun test/labels.ts                # src/index.ts
//   bun test/labels.ts dist/index.js  # a built bundle

import { resolve } from 'node:path';
import { ensureLabels } from '../scripts/download.ts';
import type * as Lib from '../src/index.ts';

await ensureLabels();

/** the parts of ens-normalize.js that core has a counterpart for */
type Upstream = {
	ens_normalize(name: string): string;
	ens_beautify(name: string): string;
	ens_normalize_fragment(frag: string, decompose?: boolean): string;
};

const target = process.argv[2] ?? 'src/index.ts';
const lib: typeof Lib = await import(resolve(target));
const upstream: Upstream = await import(new URL('./data/ens-normalize.mjs', import.meta.url).href);
const labels: string[] = await Bun.file(new URL('./data/labels.json', import.meta.url)).json();

// [field, this library, ens-normalize.js]
const fields: [string, (s: string) => string, (s: string) => string][] = [
	['normalize', (s) => lib.ensNormalize(s), (s) => upstream.ens_normalize(s)],
	['beautify', (s) => lib.ensNormalize(s, { beautify: true }), (s) => upstream.ens_beautify(s)],
	['fragment', (s) => lib.ensNormalizeFragment(s), (s) => upstream.ens_normalize_fragment(s)],
	['fragmentNFD', (s) => lib.ensNormalizeFragment(s, true), (s) => upstream.ens_normalize_fragment(s, true)],
];

// the output, or the error message
const run = (f: (s: string) => string, s: string): { output?: string; error?: string } => {
	try {
		return { output: f(s) };
	} catch (err) {
		return { error: (err as Error).message };
	}
};
const short = (v: unknown) => {
	const s = JSON.stringify(v);
	return s.length > 300 ? `${s.slice(0, 300)}… (${s.length} chars)` : s;
};

console.log(`${target} vs ens-normalize.js: ${labels.length} labels, comparing ${fields.map((f) => f[0]).join(', ')}`);
const t0 = performance.now();
const bad = new Map<string, number>(); // field => mismatches
let shown = 0;
let valid = 0;
labels.forEach((label, i) => {
	for (const [field, ours, theirs] of fields) {
		const a = run(ours, label);
		const b = run(theirs, label);
		if (field === 'normalize' && b.error === undefined) valid++;
		if (a.output === b.output && a.error === b.error) continue;
		bad.set(field, (bad.get(field) ?? 0) + 1);
		if (shown++ < 20) console.log(`mismatch: ${field} of ${short(label)}\n  here:     ${short(a)}\n  upstream: ${short(b)}`);
	}
	if ((i + 1) % 500000 == 0) console.log(`  ${i + 1}...`);
});

const total = [...bad.values()].reduce((a, b) => a + b, 0);
console.log(`${labels.length} labels (${valid} valid, ${labels.length - valid} invalid) in ${((performance.now() - t0) / 1000).toFixed(0)}s`);
console.log(total ? `${total} mismatches: ${[...bad].map(([k, n]) => `${k} ${n}`).join(', ')}` : 'no mismatches');
process.exit(total ? 1 : 0);
