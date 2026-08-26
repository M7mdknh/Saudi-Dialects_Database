import type { MainDialectGroupCode } from "@/lib/supabase/types";

/** Stable tie-break order (also used elsewhere for MAIN_GROUP_ORDER consistency). */
export const MAIN_GROUP_ORDER: readonly MainDialectGroupCode[] = [
  "hijazi",
  "najdi",
  "eastern",
  "northern",
  "southern",
];

/** Counts how many source candidates resolve to each main dialect group — each candidate counted once. */
export function countMainDialects(
  candidates: { mainGroupCode: MainDialectGroupCode | null }[],
): Partial<Record<MainDialectGroupCode, number>> {
  const counts: Partial<Record<MainDialectGroupCode, number>> = {};
  for (const c of candidates) {
    if (!c.mainGroupCode) continue;
    counts[c.mainGroupCode] = (counts[c.mainGroupCode] ?? 0) + 1;
  }
  return counts;
}

/**
 * Deterministic default main-dialect pick for a duplicate group.
 *
 * Tie-break order:
 *   1. The existing canonical entry's primary dialect, if it's tied for the lead.
 *   2. The currently-selected base candidate's dialect, if it's tied for the lead.
 *   3. Stable main-group order (hijazi → najdi → eastern → northern → southern).
 */
export function pickDefaultMainDialect(params: {
  counts: Partial<Record<MainDialectGroupCode, number>>;
  canonicalPrimaryCode?: MainDialectGroupCode | null;
  baseCandidateCode?: MainDialectGroupCode | null;
}): MainDialectGroupCode | null {
  const { counts, canonicalPrimaryCode, baseCandidateCode } = params;
  const entries = Object.entries(counts) as [MainDialectGroupCode, number][];
  if (entries.length === 0) return null;

  const maxCount = Math.max(...entries.map(([, n]) => n));
  const leaders = new Set(
    entries.filter(([, n]) => n === maxCount).map(([code]) => code),
  );
  if (leaders.size === 1) return [...leaders][0];

  if (canonicalPrimaryCode && leaders.has(canonicalPrimaryCode)) {
    return canonicalPrimaryCode;
  }
  if (baseCandidateCode && leaders.has(baseCandidateCode)) {
    return baseCandidateCode;
  }
  for (const code of MAIN_GROUP_ORDER) {
    if (leaders.has(code)) return code;
  }
  return [...leaders][0];
}
