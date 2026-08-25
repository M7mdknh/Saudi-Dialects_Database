"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface PublicDialectOption {
  id: string;
  nameAr: string;
  slug: string;
  parentId: string | null;
  mainGroupCode: string | null;
}

/**
 * Active dialect taxonomy (five main Saudi groups plus existing local
 * dialects) for the public contribution form's combobox. Read through a
 * SECURITY DEFINER function (list_public_dialects, see migration 0016) —
 * consistent with the project's convention that public reads never use a
 * direct table grant (see 0013's guided-prompt/leaderboard functions).
 */
export async function listPublicDialects(): Promise<PublicDialectOption[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_public_dialects");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    nameAr: row.name_ar,
    slug: row.slug,
    parentId: row.parent_id,
    mainGroupCode: row.main_group_code,
  }));
}
