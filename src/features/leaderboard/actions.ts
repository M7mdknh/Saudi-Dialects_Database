"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MainDialectGroupCode } from "@/lib/supabase/types";

export interface LeaderboardEntry {
  mainGroupCode: MainDialectGroupCode;
  mainGroupLabelAr: string;
  approvedWordCount: number;
}

/**
 * Ranks the five main Saudi dialect groups by approved, unique canonical
 * word count only — never derived from raw submissions. Reads live from
 * canonical_entries via the public_dialect_leaderboard() function, so a
 * newly approved/merged/reclassified word is reflected on the next request
 * without a deployment.
 */
export async function getDialectLeaderboard(): Promise<LeaderboardEntry[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("public_dialect_leaderboard");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    mainGroupCode: row.main_group_code,
    mainGroupLabelAr: row.main_group_label_ar,
    approvedWordCount: row.approved_word_count,
  }));
}
