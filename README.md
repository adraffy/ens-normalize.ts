# ens-normalize-ts

[ENSIP-15](https://docs.ens.domains/ensip/15) ENS name normalization in TypeScript.
It's a port of the library part of [ens-normalize.js](https://github.com/adraffy/ens-normalize.js), with no runtime dependencies.

| entry | min | gzip | ens-normalize.js 1.11.1 |
|---|---:|---:|---:|
| `ens-normalize-ts` (core) | 22.6 KB | 16.4 KB | 38.3 KB / 26.1 KB |
| `ens-normalize-ts/xnf` (core, native NF) | 17.0 KB | 12.1 KB | 29.3 KB |
| `ens-normalize-ts/full` (everything) | 25.0 KB | 17.6 KB | |

```ts
import { ensNormalize, ensBeautify } from 'ens-normalize-ts';

ensNormalize('RaFFY🚴‍♂️.eTh'); // "raffy🚴‍♂.eth"
ensBeautify('1⃣2⃣.eth');      // "1️⃣2️⃣.eth"
```

## API

| ens-normalize.js | here | entry |
|---|---|---|
| `ens_normalize` | `ensNormalize(name)` | core |
| `ens_beautify` | `ensBeautify(name)` | core |
| `ens_normalize_fragment` | `ensNormalizeFragment(frag, decompose?)` | core |
| `ens_split` | `ensSplit(name, preserveEmoji?)` | full |
| `ens_emoji` | `ensEmoji()` | full |
| `nfc` / `nfd` | `nfc(cps)` / `nfd(cps)` | core |
| `ens_tokenize` | `ensTokenize(name, {nf?})` | full |
| `is_combining_mark` | `isCombiningMark(cp, onlyNSM?)` | full |
| `should_escape` | `shouldEscape(cp)` | core |
| `safe_str_from_cps` | `safeStrFromCps(cps, max?, quoter?)` | full |
| `explode_cp` / `str_from_cps` | `explodeCp(s)` / `strFromCps(cps)` | full |
| `hex_cp` / `quote_cp` | `hexCp(cp)` / `quoteCp(cp)` | full |
| `versions` | `versions` (`{derived, unicode, cldr, specHash, nfHash}`) | full |

`xnf` has the same exports as core. `full` re-exports everything in core.

Error messages and outputs match 1.11.1 exactly. Differences:
- `Label.emoji` is `false` instead of `undefined` for text-only labels.
- Emoji tokens are plain arrays (no `Emoji` subclass or `is_emoji` getter), which matters on engines like Hermes where `.slice()`/`.filter()` don't preserve subclasses.

NFC/NFD is a streaming pipeline (decompose → reorder → compose) that only buffers the combining marks after the last starter.

`ens-normalize-ts/xnf` swaps the embedded NFC/NFD for `String.prototype.normalize()`.
It's smaller, but results depend on the JS engine's Unicode version.

## Development

Requires [Bun](https://bun.sh).

```sh
bun scripts/make.ts   # data/*.json => src/generated/*.ts (downloads spec if missing)
bun run build         # dist/ (esm + cjs, Bun + terser minified) + dist/types
bun test              # downloads tests if missing
```

The spec and test JSON aren't committed. They're fetched from ens-normalize.js, pinned to the commit in `scripts/download.ts`. Bump `UPSTREAM` there and run `bun run download` to update.

### Data encoding

`scripts/make.ts` serializes the spec into integer symbols.
`scripts/encoder.ts` compresses them with an adaptive binary range coder (LZMA-style, 12-bit probabilities).
`src/decoder.ts` is the matching decoder, about 60 lines.

- **Integers:** each one is written as Exp-Golomb, and its bits are modeled per context. A context is a field type such as "set gap", "run length", or "mapping residual" (`src/contexts.ts`). The top 3 mantissa bits use a bit-tree.
- **Probabilities:** each bit's probability is the average of a fast estimate (rate 1/4) and a slow one (rate 1/32).
- **Output alphabet:** the coder writes base-93 digits directly instead of bytes. The digits are printable ASCII without `'` or `\`, so the blob needs no escaping. That's about 6.5 bits per char, vs 6 for base64.
- **Mapped table:** the 1,072 entries that equal `nfd(cp)` (CJK compatibility ideographs and similar) are flagged and derived at init instead of stored.
- **Separate blobs:** NF, core ENS, and `nfc_check` (only `ensTokenize` needs it, so only `full` includes it).
- **Dropped:** NFC_QC, which the decoder never used.

| blob | here (base-93) | 1.11.1 (base64) |
|---|---:|---:|
| ENS | 10,578 | 20,100 (includes nfc_check) |
| nfc_check | 328 | |
| NF | 4,728 | 7,568 |

The make script verifies every symbol by decoding it with `src/decoder.ts`.
If you change the model, change `scripts/encoder.ts` and `src/decoder.ts` together.
