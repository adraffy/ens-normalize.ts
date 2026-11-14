// APIs that only ./full exports: label details, emoji list, CM lookup

import { compareArrays, explodeCp } from './utils.ts';
import {
	init,
	outputTokenize,
	filterFE0F,
	flat,
	isEmojiLabel,
	checkNotEmpty,
	checkLeadingUnderscore,
	checkValid,
	CM,
	NSM,
	EMOJI_LIST,
} from './lib.ts';

/** A label produced by {@link ensSplit}. */
export interface Label {
	/** input codepoints */
	input: number[];
	/** codepoint offset of this label in the name */
	offset: number;
	/** set if the label is invalid */
	error?: Error;
	/** text and emoji tokens */
	tokens?: number[][];
	/** normalized codepoints */
	output?: number[];
	/** label contains emoji */
	emoji?: boolean;
	/** script group: "ASCII", "Emoji", "Latin", "Restricted[Xxxx]", ... */
	type?: string;
}

/** split a name into labels with details (does not throw) */
export function ensSplit(name: string, preserveEmoji?: boolean): Label[] {
	if (!name) return []; // empty name allowance
	init();
	let offset = 0;
	return name.split('.').map((label) => {
		const input = explodeCp(label);
		const info: Label = { input, offset };
		offset += input.length + 1; // + stop
		try {
			// same steps as transform() in lib.ts, recording each result
			const tokens = outputTokenize(input, preserveEmoji ? (x) => x.slice() : filterFE0F);
			info.tokens = tokens.map((t) => t.cps);
			checkNotEmpty(tokens);
			const norm = (info.output = flat(tokens));
			checkLeadingUnderscore(norm);
			info.type = checkValid(tokens, norm, (info.emoji = isEmojiLabel(tokens)));
		} catch (err) {
			info.error = err as Error;
		}
		return info;
	});
}

/** all supported emoji, fully-qualified, ordered by length then lexicographically */
export function ensEmoji(): number[][] {
	init();
	return EMOJI_LIST.map((x) => [...x]).sort(compareArrays);
}

/** true if `cp` is a combining mark (or only a non-spacing mark, if `onlyNSM`) */
export function isCombiningMark(cp: number, onlyNSM?: boolean): boolean {
	init();
	return (onlyNSM ? NSM : CM).has(cp);
}
