// ensTokenize(): token-level view of a name for UIs.
// Kept out of the core build: it needs extra data (NFC_CHECK) and code.

import NFC_CHECK_DATA from './generated/nfc-check.ts';
import { Ctx } from './contexts.ts';
import { reader } from './decoder.ts';
import { strFromCps, explodeCp, compareArrays } from './utils.ts';
import { nfc } from './nf.ts';
import { init, findEmoji, filterFE0F, VALID, MAPPED, IGNORED } from './lib.ts';

const STOP = 0x2e;

let NFC_CHECK: Set<number>; // valid cps that may change under nfc

export interface StopToken {
	type: 'stop';
	cp: number;
}
export interface DisallowedToken {
	type: 'disallowed';
	cp: number;
}
export interface IgnoredToken {
	type: 'ignored';
	cp: number;
}
export interface ValidToken {
	type: 'valid';
	cps: number[];
}
export interface MappedToken {
	type: 'mapped';
	cp: number;
	cps: number[];
}
export type TextToken = DisallowedToken | IgnoredToken | ValidToken | MappedToken;
export interface EmojiToken {
	type: 'emoji';
	/** matched input codepoints */
	input: number[];
	/** normalized (FE0F removed) */
	cps: number[];
	/** fully-qualified emoji */
	emoji: number[];
}
export interface NFCToken {
	type: 'nfc';
	input: number[];
	tokens0: TextToken[];
	cps: number[];
	tokens: TextToken[];
}
export type Token = TextToken | EmojiToken | NFCToken | StopToken;


/**
 * Tokenize a name (does not throw).
 * With `nf` (default), unnormalized runs are collapsed into a single "nfc" token.
 */
export function ensTokenize(name: string, { nf = true }: { nf?: boolean } = {}): Token[] {
	init();
	NFC_CHECK ??= new Set(reader(NFC_CHECK_DATA).set(Ctx.NFC_CHECK));
	const cps = explodeCp(name);
	const tokens: Token[] = [];
	for (let i = 0; i < cps.length; ) {
		const match = findEmoji(cps, i);
		if (match) {
			const [emoji, end] = match;
			tokens.push({ type: 'emoji', emoji: [...emoji], input: cps.slice(i, end), cps: filterFE0F(emoji) });
			i = end;
		} else {
			const cp = cps[i++];
			if (cp == STOP) {
				tokens.push({ type: 'stop', cp });
			} else if (VALID.has(cp)) {
				tokens.push({ type: 'valid', cps: [cp] });
			} else if (IGNORED.has(cp)) {
				tokens.push({ type: 'ignored', cp });
			} else {
				const mapped = MAPPED.get(cp);
				tokens.push(mapped ? { type: 'mapped', cp, cps: mapped.slice() } : { type: 'disallowed', cp });
			}
		}
	}
	if (nf) {
		for (let i = 0, start = -1; i < tokens.length; i++) {
			const token = tokens[i];
			if (isText(token)) {
				if (requiresCheck(token.cps)) {
					// normalization might be needed: find adjacent text
					let end = i + 1;
					for (let pos = end; pos < tokens.length; pos++) {
						const t = tokens[pos];
						if (isText(t)) {
							if (!requiresCheck(t.cps)) break;
							end = pos + 1;
						} else if (t.type !== 'ignored') {
							break;
						}
					}
					if (start < 0) start = i;
					const slice = tokens.slice(start, end);
					const input = slice.flatMap((t) => (isText(t) ? t.cps : [])); // strip junk tokens
					const cps = nfc(input);
					if (compareArrays(cps, input)) {
						// bundle into an nfc token: tokens0 ==(process)=> input ==(nfc)=> tokens/cps
						tokens.splice(start, end - start, {
							type: 'nfc',
							input,
							cps,
							tokens0: collapseValidTokens(slice) as TextToken[],
							tokens: ensTokenize(strFromCps(cps), { nf: false }) as TextToken[],
						});
						i = start;
					} else {
						i = end - 1; // skip to end of slice
					}
					start = -1;
				} else {
					start = i; // remember last
				}
			} else if (token.type !== 'ignored') {
				start = -1;
			}
		}
	}
	return collapseValidTokens(tokens);
}

function isText(t: Token): t is ValidToken | MappedToken {
	return t.type == 'valid' || t.type == 'mapped';
}

function requiresCheck(cps: number[]): boolean {
	return cps.some((cp) => NFC_CHECK.has(cp));
}

function collapseValidTokens(tokens: Token[]): Token[] {
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].type == 'valid') {
			let j = i + 1;
			while (j < tokens.length && tokens[j].type == 'valid') j++;
			tokens.splice(i, j - i, { type: 'valid', cps: tokens.slice(i, j).flatMap((t) => (t as ValidToken).cps) });
		}
	}
	return tokens;
}
