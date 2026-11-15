# ens-normalize.ts

[![test](https://github.com/adraffy/ens-normalize.ts/actions/workflows/test.yml/badge.svg)](https://github.com/adraffy/ens-normalize.ts/actions/workflows/test.yml)

[ENSIP-15](https://docs.ens.domains/ensip/15) ENS name normalization in TypeScript.
It's a port of the library part of [ens-normalize.js](https://github.com/adraffy/ens-normalize.js), with no runtime dependencies.

```ts
import { ensNormalize, ensNormalizeFragment } from '@adraffy/ens-normalize.ts';

ensNormalize('Nick.ETH'); // "nick.eth"
ensNormalize('RaFFY🚴‍♂️.eTh'); // "raffy🚴‍♂.eth"
ensNormalize('1⃣2⃣.eth', { beautify: true }); // "1️⃣2️⃣.eth"
ensNormalizeFragment('A_b'); // "a_b" (no validation)
```

## ensNormalize

```ts
function ensNormalize(name: string, options?: NormalizeOptions): string;

type NormalizeOptions = {
	beautify?: boolean; // default: false
};
```

Normalizes `name` and returns it, or throws an `Error` if any label is invalid.

- **name:** the full name, with labels separated by `.`. An empty string returns `""`.
- **returns:** the normalized name. Use this form for hashing, comparing, and storing names.
- **`beautify: true`:** returns the display form instead. It validates the same way, but keeps emoji presentation (`FE0F`) and writes `ξ` as `Ξ` in labels that aren't Greek. Don't hash or store this form.

```ts
ensNormalize('ｂｉｔｃｏｉｎ.eth'); // "bitcoin.eth"
ensNormalize('🚴‍♂️.eth'); // "🚴‍♂.eth"
ensNormalize('🚴‍♂️.eth', { beautify: true }); // "🚴‍♂️.eth"
ensNormalize('ξ.eth', { beautify: true }); // "Ξ.eth"
ensNormalize('ξένος.eth', { beautify: true }); // "ξένος.eth" (Greek keeps ξ)
```

**Errors:** the message is the reason. When the name has more than one label, it's prefixed with the offending label, and the original error is kept as `cause`.

```ts
ensNormalize('a!b'); // throws: disallowed character: "!" {21}
ensNormalize('a!b.eth'); // throws: Invalid label "a!b": disallowed character: "!" {21}
ensNormalize('a..eth'); // throws: Invalid label "": empty label
```

The possible reasons are:
- `empty label`
- `disallowed character: …`
- `underscore allowed only at start`
- `invalid label extension: "xx--"`
- `illegal placement: …` (leading/trailing/adjacent fenced characters, or a misplaced combining mark)
- `illegal mixture: Latin + Greek "α" {3B1}` (characters from scripts that can't be mixed)
- `whole-script confusable: …`
- `duplicate non-spacing marks: …`
- `excessive non-spacing marks: …`

Quoted text in messages is followed by U+200E so right-to-left text can't flip the rest of the message.

## ensNormalizeFragment

```ts
function ensNormalizeFragment(frag: string, decompose?: boolean): string;
```

Normalizes text without validating it, so it works on partial input that isn't a complete or valid name. That makes it useful for formatting search queries and matching: normalize both the query and the candidate names, then compare or search, even when the query is only part of a label. It only throws on disallowed characters.

Pass `decompose: true` to get NFD output instead of NFC, for example to match regardless of accents by stripping combining marks afterward.

```ts
ensNormalizeFragment('A_b'); // "a_b" (ensNormalize would throw: underscore allowed only at start)
ensNormalizeFragment('ＶＩＴＡ'); // "vita"
ensNormalizeFragment('é', true); // "e\u0301"
```

## Size

| entry | min | gzip | 1.11.1 min | 1.11.1 gzip |
|---|---:|---:|---:|---:|
| `@adraffy/ens-normalize.ts` (core) | 22.7 KB | 16.4 KB | 38.3 KB | 26.1 KB |
| `@adraffy/ens-normalize.ts/xnf` (core, native NF) | 17.1 KB | 12.2 KB | 29.3 KB | 19.4 KB |
| `@adraffy/ens-normalize.ts/full` (everything) | 25.1 KB | 17.7 KB | 44.1 KB* | 28.2 KB* |

Sizes are minified ESM; gzip is level 9. The 1.11.1 columns are `index.min.js`, `index-xnf.min.js`, and `all.min.js` from its `dist/`.
\* `all.min.js` also includes the DOM helpers from `parts.js`, which aren't ported.

## Full API

| ens-normalize.js | here | entry |
|---|---|---|
| `ens_normalize` | `ensNormalize(name)` | core |
| `ens_beautify` | `ensNormalize(name, {beautify: true})` | core |
| `ens_normalize_fragment` | `ensNormalizeFragment(frag, decompose?)` | core |
| `ens_split` | `ensSplit(name, preserveEmoji?)` | full |
| `ens_emoji` | `ensEmoji()` | full |
| `ens_tokenize` | `ensTokenize(name, {nfc?})` (new shape, see below) | full |
| `is_combining_mark` | `isCombiningMark(cp, onlyNSM?)` | full |
| `should_escape` | `shouldEscape(cp)` | full |
| `safe_str_from_cps` | `safeStrFromCps(cps, max?, quoter?)` | full |
| `nfc` / `nfd` | `nfc(cps)` / `nfd(cps)` | full |
| `explode_cp` / `str_from_cps` | `explodeCp(s)` / `strFromCps(cps)` | full |
| `hex_cp` / `quote_cp` | `hexCp(cp)` / `quoteCp(cp)` | full |
| `versions` | `ensBuildInfo` (`{derived, unicode, cldr, specHash, nfHash}`) | full |

`xnf` has the same exports as core. `full` re-exports everything in core.

### ensTokenize

```ts
function ensTokenize(name: string, options?: { nfc?: boolean }): Tokenized;

type Tokenized = {
	input: number[]; // codepoints of the name
	tokens: Token[];
};

// every token covers input.slice(start, end) and says what it becomes
type Token = { start: number; end: number; output: number[] } & (
	| { type: 'valid' | 'mapped' | 'ignored' | 'disallowed' | 'stop' }
	| { type: 'emoji'; beautified: number[] } // fully-qualified form; output drops FE0F
	| { type: 'nfc'; before: Token[]; after: Token[] } // a text run that changed under NFC
);
```

It never throws and doesn't validate. The tokens cover `input` in order with no gaps. Concatenating every `output` gives the same result as `ensNormalizeFragment` (except that disallowed characters output nothing instead of throwing). `valid` tokens are runs; every other text token is one codepoint. Pass `{ nfc: false }` to skip creating `nfc` tokens.

An `nfc` token has two views. `before` holds the tokens that went into NFC, positioned in `input`. `after` holds the tokens of its `output`, positioned in `output`. `after` is usually one valid run, but a composed codepoint can be disallowed: `е` + U+0300 composes to U+0450, which ENS doesn't allow.

```ts
ensTokenize('A\u0301b💩.');
// input: [0x41, 0x301, 0x62, 0x1F4A9, 0x2E]
// tokens:
//   { type: 'nfc', start: 0, end: 2, output: [0xE1],
//     before: [
//       { type: 'mapped', start: 0, end: 1, output: [0x61] },
//       { type: 'valid', start: 1, end: 2, output: [0x301] } ],
//     after: [
//       { type: 'valid', start: 0, end: 1, output: [0xE1] } ] }
//   { type: 'valid', start: 2, end: 3, output: [0x62] }
//   { type: 'emoji', start: 3, end: 4, output: [0x1F4A9], beautified: [0x1F4A9, 0xFE0F] }
//   { type: 'stop', start: 4, end: 5, output: [0x2E] }
```

### Compatibility

Error messages and outputs match 1.11.1 exactly. Differences:
- `ensTokenize` returns the new shape above. The tests convert it back to 1.11.1's format and check it against that version's output.
- `Label.emoji` is `false` instead of `undefined` for text-only labels.
- Emoji tokens are plain arrays (no `Emoji` subclass or `is_emoji` getter), which matters on engines like Hermes where `.slice()`/`.filter()` don't preserve subclasses.

NFC/NFD is a streaming pipeline (decompose → reorder → compose) that only buffers the combining marks after the last starter.

`@adraffy/ens-normalize.ts/xnf` swaps the embedded NFC/NFD for `String.prototype.normalize()`.
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
