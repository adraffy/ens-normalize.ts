# ens-normalize.ts

[![test](https://github.com/adraffy/ens-normalize.ts/actions/workflows/test.yml/badge.svg)](https://github.com/adraffy/ens-normalize.ts/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/@adraffy/ens-normalize.ts)](https://www.npmjs.com/package/@adraffy/ens-normalize.ts)

[ENSIP-15](https://docs.ens.domains/ensip/15) ENS name normalization in TypeScript.
It's a port of the library part of [ens-normalize.js](https://github.com/adraffy/ens-normalize.js), with no runtime dependencies.

Run the tests in your browser: [validate](https://adraffy.github.io/ens-normalize.ts/test/browser/validate.html) · [report-nf](https://adraffy.github.io/ens-normalize.ts/test/browser/report-nf.html)

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

The possible reasons, with the exact format and an example of each. `"x" {HEX}` is a quoted character followed by its codepoint in hex. The quote is left out for invisible characters.

| reason | meaning | example input → message |
|---|---|---|
| `empty label` | the label has no characters left once ignored ones (like U+FE0F) are removed | `"a..eth"` → `Invalid label "": empty label` |
| `disallowed character: "x" {HEX}` | a character that's never allowed in a name | `"a b"` → `disallowed character: " " {20}`<br>`"a\u200Db"` → `disallowed character: {200D}` |
| `underscore allowed only at start` | underscores can only be a prefix (`"__a"` is fine) | `"a_b"` |
| `invalid label extension: "xx--"` | ASCII labels can't have `--` as the 3rd and 4th characters (reserved, like `xn--`) | `"xn--ls8h"` → `invalid label extension: "xn--"` |
| `illegal placement: leading NAME`<br>`illegal placement: trailing NAME`<br>`illegal placement: NAME + NAME` | a fenced character (apostrophe `’`, fraction slash `⁄`, middle dot `・`) can't start or end a label, or touch another one. `'` maps to `’`. | `"'a"` → `illegal placement: leading apostrophe`<br>`"a・"` → `illegal placement: trailing middle dot`<br>`"1⁄⁄2"` → `illegal placement: fraction slash + fraction slash` |
| `illegal placement: leading combining mark` | the label starts with a combining mark | `"\u0303a"` |
| `illegal placement: emoji + combining mark: "EMOJI + ◌x"` | a combining mark directly after an emoji | `"💩\u0303"` → `illegal placement: emoji + combining mark: "💩 + ◌̃"` |
| `illegal mixture: GROUP + "x" {HEX}`<br>`illegal mixture: GROUP + OTHER "x" {HEX}` | characters from scripts that can't be mixed. GROUP is the label's script; OTHER is the script the conflicting character belongs to, when it has one. | `"aα"` → `illegal mixture: Latin + Greek "α" {3B1}` |
| `whole-script confusable: GROUP/OTHER` | every character could be mistaken for one in another script, so the whole label looks like a name in OTHER | `"аррӏе"` (Cyrillic) → `whole-script confusable: Cyrillic/Latin` |
| `duplicate non-spacing marks: "◌x" {HEX}` | the same non-spacing mark twice in a row | `"\u0622\u064D\u064D"` → `duplicate non-spacing marks: "◌ٍ" {64D}` |
| `excessive non-spacing marks: "TEXT" (N/4)` | more than 4 non-spacing marks in a row | `"\u0625\u0610\u0611\u0612\u0613"` → `excessive non-spacing marks: "إؐؑؒؓ" (5/4)` (marks are counted after NFD) |

GROUP and OTHER are script group names like `Latin`, `Greek`, or `Restricted[Cher]` (restricted scripts use their ISO 15924 code).

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

<table>
<thead>
<tr><th rowspan="2">entry</th><th colspan="2">ens-normalize.ts</th><th colspan="2"><a href="https://github.com/adraffy/ens-normalize.js">ens-normalize.js</a> 1.11.1</th><th rowspan="2">min savings</th></tr>
<tr><th>min</th><th>gzip</th><th>min</th><th>gzip</th></tr>
</thead>
<tbody>
<tr><td><code>@adraffy/ens-normalize.ts</code> (core)</td><td align="right">22.1 KB</td><td align="right">16.1 KB</td><td align="right">38.3 KB</td><td align="right">26.1 KB</td><td align="right">42.4%</td></tr>
<tr><td><code>@adraffy/ens-normalize.ts/xnf</code> (core, native NF)</td><td align="right">16.7 KB</td><td align="right">11.9 KB</td><td align="right">29.3 KB</td><td align="right">19.4 KB</td><td align="right">42.9%</td></tr>
<tr><td><code>@adraffy/ens-normalize.ts/full</code> (everything)</td><td align="right">24.6 KB</td><td align="right">17.4 KB</td><td align="right">44.1 KB*</td><td align="right">28.2 KB*</td><td align="right">44.3%</td></tr>
</tbody>
</table>

Sizes are minified ESM; gzip is level 9. Savings is min vs 1.11.1 min. The 1.11.1 columns are `index.min.js`, `index-xnf.min.js`, and `all.min.js` from its `dist/`.
\* `all.min.js` also includes the DOM helpers from `parts.js`, which aren't ported.

**Speed:** normalizing is as fast as 1.11.1 (about 75 ms for the 38,614 validation names under Bun). The first call decodes the data in about 48 ms, vs 54 ms for 1.11.1.

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

## Browser tests

Static pages in `test/browser/`, published to GitHub Pages at [adraffy.github.io/ens-normalize.ts](https://adraffy.github.io/ens-normalize.ts/):
- **[validate.html](https://adraffy.github.io/ens-normalize.ts/test/browser/validate.html)** runs the ENSIP-15 validation tests against each bundle (core, xnf, full). xnf uses the browser's own NFC/NFD, so this shows whether a given browser's Unicode tables are current.
- **[report-nf.html](https://adraffy.github.io/ens-normalize.ts/test/browser/report-nf.html)** runs Unicode's NormalizationTest against the library's NFC/NFD and the browser's `String.prototype.normalize()`.

`.github/workflows/pages.yml` builds `dist/`, downloads the test data, and publishes a site that mirrors the repo layout, so the pages' relative paths work. To run them locally, build and download the data, then serve the repo root with any static file server (for example `python3 -m http.server`) and open `/test/browser/`.


Requires [Bun](https://bun.sh).

```sh
bun scripts/make.ts   # data/*.json => src/generated/*.ts (downloads spec if missing)
bun run build         # dist/ (esm + cjs, Bun + terser minified) + dist/types
bun test              # downloads tests if missing
bun run test:labels   # exhaustive check against ens-normalize.js (see below)
```

The spec and test JSON aren't committed. They're fetched from ens-normalize.js, pinned to the commit in `scripts/download.ts`. Bump `UPSTREAM` there and run `bun run download` to update.

### Exhaustive check

`bun run test:labels` runs every label in [adraffy/ens-labels](https://github.com/adraffy/ens-labels) (3,422,100 labels seen in ENS contract events and primary names) through this library and through ens-normalize.js, and compares every output and error message of the core API: normalize, beautify, and fragment.
It isn't part of `bun test`: the first run downloads `labels.json` (about 50 MB) and ens-normalize.js, both pinned in `scripts/download.ts`, and a run takes about half a minute.
Pass a path to check a built bundle instead of the source, for example `bun test/labels.ts dist/index.js`.
`ensSplit` and `ensTokenize` aren't compared here; `test/api.test.ts` checks them against output recorded from 1.11.1.

### Data encoding

`scripts/make.ts` serializes the spec into integer symbols.
`scripts/encoder.ts` compresses them with an adaptive binary range coder (LZMA-style, 12-bit probabilities).
`src/decoder.ts` is the matching decoder, about 60 lines.

- **Integers:** each one is written as Exp-Golomb, and its bits are modeled per context. A context is a field type such as "set gap", "run length", or "mapping residual" (`src/contexts.ts`). The top 3 mantissa bits use a bit-tree.
- **Probabilities:** each bit's probability is the average of a fast estimate (rate 1/4) and a slow one (rate 1/32).
- **Output alphabet:** the coder writes base-93 digits directly instead of bytes. The digits are printable ASCII without `'` or `\`, so the blob needs no escaping. That's about 6.5 bits per char, vs 6 for base64.
- **Mapped table:** the 1,072 entries that equal `nfd(cp)` (CJK compatibility ideographs and similar) are flagged and derived at init instead of stored. Gaps between mapped codepoints don't count the valid ones, which are already known from the groups. An entry's first output is predicted from the previous entry of the same width, shifted by the distance between their keys.
- **Combining classes:** every codepoint with a combining class is a combining mark, so the NF blob stores them as indices into the ENS blob's CM set. That's why `lib.ts` loads the NF tables (`initNF(cm)`).
- **Whole-script confusables:** each member names its whole by recency rank (move-to-front) instead of a back-reference.
- **Separate blobs:** NF, core ENS, and `nfc_check` (only `ensTokenize` needs it, so only `full` includes it). The NF blob needs CM from the ENS blob to decode.
- **Dropped:** NFC_QC, which the decoder never used.

| blob | here (base-93) | 1.11.1 (base64) |
|---|---:|---:|
| ENS | 10,297 | 20,100 (includes nfc_check) |
| nfc_check | 328 | |
| NF | 4,461 | 7,568 |

The make script verifies every symbol by decoding it with `src/decoder.ts`.
If you change the model, change `scripts/encoder.ts` and `src/decoder.ts` together.
