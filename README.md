# ens-normalize-ts

[ENSIP-15](https://docs.ens.domains/ensip/15) ENS name normalization in TypeScript.
It's a port of the library part of [ens-normalize.js](https://github.com/adraffy/ens-normalize.js), with no runtime dependencies.

| build | min | gzip | ens-normalize.js 1.11.1 |
|---|---:|---:|---:|
| `dist/index.js` | 25.8 KB | 17.9 KB | 38.3 KB / 26.1 KB |
| `dist/xnf.js` (native NF) | 20.0 KB | 13.6 KB | 29.3 KB |

```ts
import { ensNormalize, ensBeautify } from 'ens-normalize-ts';

ensNormalize('RaFFY🚴‍♂️.eTh'); // "raffy🚴‍♂.eth"
ensBeautify('1⃣2⃣.eth');      // "1️⃣2️⃣.eth"
```

## API

| ens-normalize.js | here |
|---|---|
| `ens_normalize` | `ensNormalize(name)` |
| `ens_beautify` | `ensBeautify(name)` |
| `ens_normalize_fragment` | `ensNormalizeFragment(frag, decompose?)` |
| `ens_split` | `ensSplit(name, preserveEmoji?)` |
| `ens_tokenize` | `ensTokenize(name, {nf?})` |
| `ens_emoji` | `ensEmoji()` |
| `is_combining_mark` | `isCombiningMark(cp, onlyNSM?)` |
| `should_escape` | `shouldEscape(cp)` |
| `safe_str_from_cps` | `safeStrFromCps(cps, max?, quoter?)` |
| `nfc` / `nfd` | `nfc(cps)` / `nfd(cps)` |
| `explode_cp` / `str_from_cps` | `explodeCp(s)` / `strFromCps(cps)` |
| `hex_cp` / `quote_cp` | `hexCp(cp)` / `quoteCp(cp)` |
| `versions` | `versions` (`{derived, unicode, cldr, specHash, nfHash}`) |

Error messages and outputs match 1.11.1 exactly. Differences:
- `Label.emoji` is `false` instead of `undefined` for text-only labels.
- Emoji tokens are plain arrays (no `Emoji` subclass or `is_emoji` getter), which matters on engines like Hermes where `.slice()`/`.filter()` don't preserve subclasses.

NFC/NFD is a streaming pipeline (decompose → reorder → compose) that only buffers the combining marks after the last starter.

`ens-normalize-ts/xnf` swaps the embedded NFC/NFD for `String.prototype.normalize()`.
It's smaller, but results depend on the JS engine's Unicode version.

## Development

Requires [Bun](https://bun.sh).

```sh
./download.sh       # data/{spec,nf}.json + test/data/{tests,nf-tests}.json
bun scripts/make.ts # data/*.json => src/generated/*.ts
bun run build       # dist/ (esm + cjs, minified) + dist/types
bun test
```

### Data encoding

`scripts/make.ts` serializes the spec into integer symbols.
`scripts/encoder.ts` compresses them with an adaptive binary range coder (LZMA-style, 12-bit probabilities).
`src/decoder.ts` is the matching decoder, about 60 lines.

- **Integers:** each one is written as Exp-Golomb, and its bits are modeled per context. A context is a field type such as "set gap", "run length", or "mapping residual". The top 3 mantissa bits use a bit-tree.
- **Output alphabet:** the coder writes base-90 digits directly instead of bytes. The digits are printable ASCII without `'` or `\`, so the blob needs no escaping. That's about 6.5 bits per char, vs 6 for base64.
- **Mapped table:** the 1,072 entries that equal `nfd(cp)` (CJK compatibility ideographs and similar) are flagged and derived at init instead of stored.
- **Dropped:** NFC_QC, which the decoder never used.

| blob | here (base-90) | 1.11.1 (base64) |
|---|---:|---:|
| ENS | 11,166 | 20,100 |
| NF | 4,815 | 7,568 |

The make script verifies every symbol by decoding it with `src/decoder.ts`.
If you change the model, change `scripts/encoder.ts` and `src/decoder.ts` together.
