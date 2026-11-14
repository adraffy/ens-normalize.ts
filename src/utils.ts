/** codepoint as uppercase hex, at least 2 digits: 0x1F4A9 => "1F4A9" */
export function hexCp(cp: number): string {
	return cp.toString(16).toUpperCase().padStart(2, '0');
}

/** codepoint as {HEX}: 0x1F4A9 => "{1F4A9}" (like "\u{X}" without the "\u") */
export function quoteCp(cp: number): string {
	return `{${hexCp(cp)}}`;
}

/** string => codepoints */
export function explodeCp(s: string): number[] {
	const cps: number[] = [];
	for (let pos = 0, len = s.length; pos < len; ) {
		const cp = s.codePointAt(pos)!;
		pos += cp < 0x10000 ? 1 : 2;
		cps.push(cp);
	}
	return cps;
}

/** codepoints => string */
export function strFromCps(cps: readonly number[]): string {
	const chunk = 4096; // avoid large spreads
	const len = cps.length;
	if (len < chunk) return String.fromCodePoint(...cps);
	const buf: string[] = [];
	for (let i = 0; i < len; ) buf.push(String.fromCodePoint(...cps.slice(i, (i += chunk))));
	return buf.join('');
}

/** compare by length, then lexicographically */
export function compareArrays(a: readonly number[], b: readonly number[]): number {
	const n = a.length;
	let c = n - b.length;
	for (let i = 0; c == 0 && i < n; i++) c = a[i] - b[i];
	return c;
}
