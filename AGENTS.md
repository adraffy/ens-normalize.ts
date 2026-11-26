# AGENTS.md

Guidance for AI coding agents working in this repo. See README.md for the public API.

## What this is

A TypeScript port of the library part of [ens-normalize.js](https://github.com/adraffy/ens-normalize.js) (ENSIP-15 name normalization). Published to npm as `@adraffy/ens-normalize.ts`. The two priorities are:

1. **Correctness:** normalized output and error messages must match the reference ENSIP-15 implementation in [ens-normalize-derive](https://github.com/adraffy/ens-normalize-derive) (`src/ensip15.ts`, which reproduces ens-normalize.js 1.11.1 exactly on its spec), as encoded in `tests.json`. The deliberate differences from 1.11.1 are listed under "Compatibility" in README.md.
2. **Size:** the core bundle should stay as small as possible. Check the size of every change (see Commands).

There are no runtime dependencies. Keep it that way.

## Commands

Requires [Bun](https://bun.sh) 1.4+.

```sh
bun install
bun test             # all tests (downloads test data on first run)
bun run test:labels  # core API on every known ENS label vs ens-normalize.js (about 50 MB download, half a minute)
bun run typecheck
bun run build        # dist/ (Bun + terser minified, ESM + CJS) + dist/types; prints sizes
bun scripts/make.ts  # regenerate src/generated/* from data/spec.json + data/nf.json
```

Run `bun test`, `bun run typecheck`, and `bun run build` before considering a change done. Report the size change of `index.js` (the core bundle) from the build output.

## Layout

| path | what |
|---|---|
| `src/index.ts` | core entry: `ensNormalize`, `ensNormalizeFragment` |
| `src/full.ts` | full entry: core + everything else |
| `src/lib.ts` | data loading (`init`) and validation (`processLabel`, `checkValid`, ...) |
| `src/extras.ts` | `ensSplit`, `ensEmoji`, `isCombiningMark` (full only) |
| `src/tokenize.ts` | `ensTokenize` (full only; has its own `nfc-check` blob) |
| `src/nf.ts` | embedded NFC/NFD, a streaming decompose → reorder → compose pipeline; `lib.ts` loads its tables with `initNF(cm)` |
| `src/nf-native.ts` | `String.prototype.normalize()` swap-in for the `xnf` build |
| `src/decoder.ts` | range decoder + `readMapped` |
| `src/contexts.ts` | context ids shared by the encoder and the readers |
| `src/generated/` | **generated, do not edit**: data blobs and `ensBuildInfo` |
| `scripts/make.ts` | encodes the spec into `src/generated/` and verifies every symbol decodes |
| `scripts/encoder.ts` | range encoder (must mirror `src/decoder.ts`) |
| `scripts/build.ts` | bundles the `index`, `xnf`, and `full` entries |
| `scripts/download.ts` | fetches spec + test data from ens-normalize-derive's `main`, plus what `test/labels.ts` needs; sources are branches, not commits |
| `test/` | bun tests; `test/fixtures/api-1.11.1.json` is output recorded from ens-normalize.js 1.11.1 |
| `test/labels.ts` | exhaustive comparison of the core API against ens-normalize.js over adraffy/ens-labels (not part of `bun test`) |
| `test/browser/` | static browser test pages, deployed to GitHub Pages |

`data/` and `test/data/` are downloaded and gitignored.

## Rules

- **Encoder and decoder change together.** The coder's constants (radix 93, 12-bit probabilities, fast/slow rates 2 and 5, tree depth 3, 2048 keys per context, context ids below 128) are written as literals in both `scripts/encoder.ts` and `src/decoder.ts`. The order of reads in `lib.ts`/`nf.ts`/`tokenize.ts` must match the order of writes in `make.ts`. `make.ts` replays every symbol through the real decoder and throws on a mismatch.
- **Context ids live in `src/contexts.ts`.** A set uses 4 consecutive ids, and a mapped table uses 17. Don't overlap ranges.
- **Regenerate after encoding changes:** run `bun scripts/make.ts` and commit `src/generated/`. CI fails if regenerating changes those files. CI downloads from ens-normalize-derive's `main`, so it also fails when the data there changes; then follow "Updating the spec".
- **Don't edit `src/generated/`** by hand.
- **Keep parity.** If a change alters any output or error message, it's a bug unless it was asked for. Then update README "Compatibility", and update the conversion or skip list in `test/api.test.ts`. Never regenerate `test/fixtures/api-1.11.1.json` from this library; it has to come from ens-normalize.js. For changes to the data encoding, the readers, or the build, also run `bun run test:labels` (it takes a bundle path too, e.g. `bun test/labels.ts dist/index.js`).
- **Don't use `Array` subclasses or rely on `Symbol.species`.** Hermes (React Native) doesn't support it; see ens-normalize.js#35. Emoji are tracked as `{ cps, emoji: true }` tokens.
- **Keep core lean.** Anything that only `full` needs belongs in `extras.ts`/`tokenize.ts`, or in its own data blob. Bun doesn't inline constants across modules unless they're a `const enum`.
- **Property names are renamed by terser** (`scripts/build.ts`). Core and xnf rename every property except the ones in `CORE_PROPS.reserved`, so a new option or anything else that crosses the public boundary of core must be added there. Full only renames the internal names in `FULL_PROPS`; add new internal properties there, but never a name that is also a public field. Terser never renames a property that shares its name with a builtin (`name`, `has`, `groups`, `state`, ...), so give internal properties names that don't (`typeName`, `groupSet`).
- **Init is on the clock too.** The first call decodes everything, so check cold init (a fresh process, first `ensNormalize()` call, in Bun and Node) when changing `init()`, the readers, or the decoder. Things that made it slow before: sparse arrays in the decoder, copying the 100K+ Han chunk into each group that uses it, and work done for every valid cp. Closures created while reading keep that whole scope alive (the reader and its tables), so don't store them on long-lived objects.
- **Language level:** emitted code may use up to ES2021 (`??=`, `?.`). The browser test pages avoid anything newer, so older browsers can run them.
- **Size experiments:** try ideas in the scratch space first, measure the blob size reported by `make.ts` and the bundle size reported by `build.ts`, and only keep what pays for its code.

## Updating the spec

1. `DERIVE` in `scripts/download.ts` follows ens-normalize-derive's `main` while that repo is a work in progress.
2. Run `bun run download --force`, then `bun scripts/make.ts`, then `bun test`.
3. The 1.11.1 fixture (`test/fixtures/api-1.11.1.json`) differs where the spec changed on purpose. Don't regenerate it from this library: extend the conversion (`unicode18`) or the `DISALLOWED` list in `test/api.test.ts`, with the reason.
4. `bun run test:labels` still compares against ens-normalize.js 1.11.1, so with a newer spec its mismatches are the spec's changes. They should equal ens-normalize-derive's `bun run registrations` (BROKEN + ALLOWED + MESSAGE).

## Releasing

1. Bump `version` in `package.json` and add `.github/releases/vX.Y.Z.md`.
2. Commit, then tag `vX.Y.Z` and push the tag. `.github/workflows/release.yml` checks that the tag matches `package.json`, builds, tests, and creates the GitHub Release with the npm tarball.
3. Publishing to npm is manual: `bun run build && bun publish --access public`.

## Working with the maintainer

- Commit as you go, but don't push unless asked.
- Don't publish to npm or create releases unless asked.
