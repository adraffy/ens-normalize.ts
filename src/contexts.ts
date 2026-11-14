// Context ids for the encoded payloads, shared by scripts/make.ts and the readers.
// Each id selects an independent probability model (see src/decoder.ts).
// A set uses 3 consecutive ids. A mapped table uses 17 (see readMapped).

// ens
export const enum Ctx {
	MAPPED = 0,
	IGNORED = 20,
	CM = 23,
	NSM = 26, // indices into CM
	ESCAPE = 29,
	NFC_CHECK = 32,
	CHUNK_COUNT = 35,
	CHUNK = 36,
	UNRESTRICTED = 40,
	GROUP_PRIMARY = 42, // chunk indices, then extra set at +3
	GROUP_SECONDARY = 48, // same
	GROUP_NSM = 54,
	WHOLE_VALID = 60,
	WHOLE_CONFUSED = 63,
	WHOLE_LINK = 66,
	EMOJI_CPS = 70,
	EMOJI_STATE = 73,
	EMOJI_BRANCH = 74,
	GROUP_NAME = 100, // +0..4 by letter position

	// nf
	RANK_COUNT = 0,
	RANK = 1,
	EXCLUSIONS = 4,
	DECOMP = 10,
}
