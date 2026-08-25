"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MainDialectGroupCode } from "@/lib/supabase/types";

export interface LeaderboardEntry {
  mainGroupCode: MainDialectGroupCode;
  mainGroupLabelAr: string;
  /** Participation: legitimate stored submissions for this group, counted the instant they're received — drives ranking. Never exposes submitted text. */
  submissionCount: number;
  /** Publication: unique approved canonical words currently explorable — unaffected by pending/rejected submissions. */
  approvedWordCount: number;
  rank: number;
}

/**
 * Ranks the five main Saudi dialect groups by immediate community
 * participation (submission_count) — every legitimately stored submission
 * counts the instant it's committed, before any admin review. This is
 * intentionally different from the public dictionary: approvedWordCount
 * still reflects only approved canonical words and still drives the
 * explorer/export. Reads live from raw_word_submissions/canonical_entries
 * via public_dialect_leaderboard(), so a new submission or a reclassified
 * dialect is reflected on the next request without a deployment.
 */
export async function getDialectLeaderboard(): Promise<LeaderboardEntry[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("public_dialect_leaderboard");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    mainGroupCode: row.main_group_code,
    mainGroupLabelAr: row.main_group_label_ar,
    submissionCount: row.submission_count,
    approvedWordCount: row.approved_word_count,
    rank: row.rank,
  }));
}
