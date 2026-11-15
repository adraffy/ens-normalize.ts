// Context ids for the encoded payloads, shared by scripts/make.ts and the readers.
// Each id selects an independent probability model (see src/decoder.ts).
// A set uses 4 consecutive ids. A mapped table uses 17 (see readMapped).

export const enum Ctx {
	// ens
	MAPPED = 0,
	IGNORED = 20,
	CM = 24,
	NSM = 28, // indices into CM
	ESCAPE = 32,
	CHUNK_COUNT = 36,
	CHUNK = 37,
	UNRESTRICTED = 41,
	GROUP_PRIMARY = 42, // chunk indices, then extra set at +4
	GROUP_SECONDARY = 50, // same
	GROUP_NSM = 58,
	WHOLE_VALID = 59,
	WHOLE_CONFUSED = 63,
	WHOLE_LINK = 67,
	VALID_PARTS = 68, // decomposed parts of valid cps that aren't valid themselves
	EMOJI_CPS = 72,
	EMOJI_STATE = 76,
	EMOJI_BRANCH = 77,
	GROUP_NAME = 100, // +0..4 by letter position

	// nfc-check (separate payload)
	NFC_CHECK = 0,

	// nf
	RANK_COUNT = 0,
	RANK = 1,
	EXCLUSIONS = 5,
	DECOMP = 10,
}
