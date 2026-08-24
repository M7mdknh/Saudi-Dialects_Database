/**
 * Versioned Arabic search-key normalization.
 *
 * Used only to derive comparison keys for duplicate detection and search.
 * Never use the output to replace or display contributor-facing text — the
 * original Arabic must always be preserved verbatim (see data-model.md).
 *
 * v1 rules: NFC normalize, trim, collapse internal whitespace, strip tatweel,
 * strip combining diacritics. Does NOT collapse ة/ه, ى/ي, or hamza forms —
 * any such expansion must be a new, separately versioned function.
 */
export const SEARCH_KEY_VERSION = 1;

const TATWEEL = /ـ/g;
const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٟۖ-ۜ۟-۪ۨ-ۭ࣓-ࣣ࣡-ࣿ]/g;

export function toSearchKey(input: string): string {
  return input
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .replace(TATWEEL, "")
    .replace(ARABIC_DIACRITICS, "")
    .toLowerCase();
}
