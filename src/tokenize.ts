// ensTokenize(): a token-level view of a name, for UIs that highlight
// what each part of the input becomes. Only ./full includes it,
// since it needs extra data (NFC_CHECK) and code.

import NFC_CHECK_DATA from './generated/nfc-check.ts';
import { Ctx } from './contexts.ts';
import { reader } from './decoder.ts';
import { explodeCp, compareArrays } from './utils.ts';
import { nfc } from './nf.ts';
import { init, findEmoji, filterFE0F, VALID, MAPPED, IGNORED } from './lib.ts';

const STOP = 0x2e;

let NFC_CHECK: Set<number>; // valid cps that may change under nfc

interface BaseToken {
	/** index of the first codepoint in {@link Tokenized.input} */
	start: number;
	/** index after the last codepoint (exclusive) */
	end: number;
	/** what this part normalizes to ([] for ignored and disallowed) */
	output: number[];
}

/**
 * - valid: a run of valid codepoints (output = input)
 * - mapped: one codepoint replaced by its mapping
 * - ignored: one codepoint that's removed
 * - disallowed: one codepoint that makes the name invalid
 * - stop: the label separator "."
 */
export interface TextToken extends BaseToken {
	type: 'valid' | 'mapped' | 'ignored' | 'disallowed' | 'stop';
}

export interface EmojiToken extends BaseToken {
	type: 'emoji';
	/** fully-qualified form (with FE0F), as shown by beautify; output has FE0F removed */
	beautified: number[];
}

/** a run of valid and mapped text whose output changed under NFC */
export interface NFCToken extends BaseToken {
	type: 'nfc';
	/** the tokens before NFC (valid, mapped, ignored), positioned in {@link Tokenized.input} */
	before: TextToken[];
	/**
	 * the tokens of `output` (after NFC), positioned in `output`, not input.
	 * Usually one valid run; a composed codepoint can be disallowed.
	 */
	after: Token[];
}

export type Token = TextToken | EmojiToken | NFCToken;

export interface Tokenized {
	/** codepoints of the name; token start/end index into this */
	input: number[];
	tokens: Token[];
}

export type TokenizeOptions = {
	/** combine text runs that change under NFC into "nfc" tokens (default: true) */
	nfc?: boolean;
};

/**
 * Tokenize a name without validating it (never throws).
 * Concatenating every token's output gives the normalized text (minus disallowed characters).
 */
export function ensTokenize(name: string, { nfc: collapse = true }: TokenizeOptions = {}): Tokenized {
	init();
	NFC_CHECK ??= new Set(reader(NFC_CHECK_DATA).set(Ctx.NFC_CHECK));
	const input = explodeCp(name);
	let tokens = tokenize(input);
	if (collapse) tokens = collapseNFC(tokens);
	return { input, tokens: collapseValid(tokens) };
}

// one token per codepoint (or emoji)
function tokenize(input: number[]): Token[] {
	const tokens: Token[] = [];
	for (let start = 0; start < input.length; ) {
		const match = findEmoji(input, start);
		if (match) {
			const [emoji, end] = match;
			tokens.push({ type: 'emoji', start, end, output: filterFE0F(emoji), beautified: [...emoji] });
			start = end;
			continue;
		}
		const cp = input[start];
		const mapped = MAPPED.get(cp);
		const token = (type: TextToken['type'], output: number[] = []) => tokens.push({ type, start, end: start + 1, output });
		if (cp == STOP) token('stop', [cp]);
		else if (VALID.has(cp)) token('valid', [cp]);
		else if (IGNORED.has(cp)) token('ignored');
		else if (mapped) token('mapped', [...mapped]);
		else token('disallowed');
		start++;
	}
	return tokens;
}

const isText = (t: Token) => t.type == 'valid' || t.type == 'mapped';
const requiresCheck = (t: Token) => t.output.some((cp) => NFC_CHECK.has(cp));

// replace runs of text that change under NFC with a single nfc token
// a run starts at the last text token before the first one that requires a check
// (its base character), and extends over adjacent text that requires a check
// (ignored tokens in between are included)
function collapseNFC(tokens: Token[]): Token[] {
	for (let i = 0, start = -1; i < tokens.length; i++) {
		const token = tokens[i];
		if (isText(token)) {
			if (requiresCheck(token)) {
				let end = i + 1;
				for (let pos = end; pos < tokens.length; pos++) {
					const t = tokens[pos];
					if (isText(t)) {
						if (!requiresCheck(t)) break;
						end = pos + 1;
					} else if (t.type !== 'ignored') {
						break;
					}
				}
				if (start < 0) start = i;
				const before = tokens.slice(start, end) as TextToken[];
				const cps = before.flatMap((t) => (isText(t) ? t.output : []));
				const output = nfc(cps);
				if (compareArrays(output, cps)) {
					tokens.splice(start, end - start, {
						type: 'nfc',
						start: before[0].start,
						end: before[before.length - 1].end,
						output,
						before: collapseValid(before) as TextToken[],
						after: collapseValid(tokenize(output)),
					});
					i = start;
				} else {
					i = end - 1; // skip to end of run
				}
				start = -1;
			} else {
				start = i; // possible base character
			}
		} else if (token.type !== 'ignored') {
			start = -1;
		}
	}
	return tokens;
}

// merge adjacent valid tokens into one
function collapseValid(tokens: Token[]): Token[] {
	const ret: Token[] = [];
	for (const t of tokens) {
		const prev = ret[ret.length - 1];
		if (t.type == 'valid' && prev?.type == 'valid') {
			ret[ret.length - 1] = { type: 'valid', start: prev.start, end: t.end, output: [...prev.output, ...t.output] };
		} else {
			ret.push(t);
		}
	}
	return ret;
}
