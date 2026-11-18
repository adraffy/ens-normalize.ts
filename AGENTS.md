# AGENTS.md

Guidance for AI coding agents working in this repo. See README.md for the public API.

## What this is

A TypeScript port of the library part of [ens-normalize.js](https://github.com/adraffy/ens-normalize.js) (ENSIP-15 name normalization). Published to npm as `@adraffy/ens-normalize.ts`. The two priorities are:

1. **Correctness:** normalized output and error messages must match ens-normalize.js exactly. The deliberate differences are listed under "Compatibility" in README.md.
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
| `src/nf.ts` | embedded NFC/NFD, a streaming decompose → reorder → compose pipeline |
| `src/nf-native.ts` | `String.prototype.normalize()` swap-in for the `xnf` build |
| `src/decoder.ts` | range decoder + `readMapped` |
| `src/contexts.ts` | context ids shared by the encoder and the readers |
| `src/generated/` | **generated, do not edit**: data blobs and `ensBuildInfo` |
| `scripts/make.ts` | encodes the spec into `src/generated/` and verifies every symbol decodes |
| `scripts/encoder.ts` | range encoder (must mirror `src/decoder.ts`) |
| `scripts/build.ts` | bundles the `index`, `xnf`, and `full` entries |
| `scripts/download.ts` | fetches spec + test data, pinned to an upstream commit (`UPSTREAM`) |
| `test/` | bun tests; `test/fixtures/api-1.11.1.json` is output recorded from ens-normalize.js 1.11.1 |
| `test/labels.ts` | exhaustive comparison of the core API against ens-normalize.js over adraffy/ens-labels (not part of `bun test`) |
| `test/browser/` | static browser test pages, deployed to GitHub Pages |

`data/` and `test/data/` are downloaded and gitignored.

## Rules

- **Encoder and decoder change together.** The coder's constants (radix 93, 12-bit probabilities, fast/slow rates 2 and 5, tree depth 3, 2048 keys per context) are written as literals in both `scripts/encoder.ts` and `src/decoder.ts`. The order of reads in `lib.ts`/`nf.ts`/`tokenize.ts` must match the order of writes in `make.ts`. `make.ts` replays every symbol through the real decoder and throws on a mismatch.
- **Context ids live in `src/contexts.ts`.** A set uses 4 consecutive ids, and a mapped table uses 17. Don't overlap ranges.
- **Regenerate after encoding changes:** run `bun scripts/make.ts` and commit `src/generated/`. CI fails if regenerating changes those files.
- **Don't edit `src/generated/`** by hand.
- **Keep parity.** If a change alters any output or error message, it's a bug unless it was asked for. Then update README "Compatibility", and update the conversion or skip list in `test/api.test.ts`. Never regenerate `test/fixtures/api-1.11.1.json` from this library; it has to come from ens-normalize.js. For changes to the data encoding, the readers, or the build, also run `bun run test:labels` (it takes a bundle path too, e.g. `bun test/labels.ts dist/index.js`).
- **Don't use `Array` subclasses or rely on `Symbol.species`.** Hermes (React Native) doesn't support it; see ens-normalize.js#35. Emoji are tracked as `{ cps, emoji: true }` tokens.
- **Keep core lean.** Anything that only `full` needs belongs in `extras.ts`/`tokenize.ts`, or in its own data blob. Bun doesn't inline constants across modules unless they're a `const enum`, and it doesn't mangle property names, so short property names matter.
- **Language level:** emitted code may use up to ES2021 (`??=`, `?.`). The browser test pages avoid anything newer, so older browsers can run them.
- **Size experiments:** try ideas in the scratch space first, measure the blob size reported by `make.ts` and the bundle size reported by `build.ts`, and only keep what pays for its code.

## Updating the spec

1. Bump `UPSTREAM` in `scripts/download.ts` to the new ens-normalize.js commit.
2. Run `bun run download`, then `bun scripts/make.ts`, then `bun test`.
3. The 1.11.1 fixture may legitimately differ for a new Unicode version. If so, regenerate it from the matching ens-normalize.js release, not from this library.

## Releasing

1. Bump `version` in `package.json` and add `.github/releases/vX.Y.Z.md`.
2. Commit, then tag `vX.Y.Z` and push the tag. `.github/workflows/release.yml` checks that the tag matches `package.json`, builds, tests, and creates the GitHub Release with the npm tarball.
3. Publishing to npm is manual: `bun run build && bun publish --access public`.

## Working with the maintainer

- Commit as you go, but don't push unless asked.
- Don't publish to npm or create releases unless asked.
