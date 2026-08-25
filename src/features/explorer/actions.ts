"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MainDialectGroupCode } from "@/lib/supabase/types";

export interface DialectWordEntry {
  id: string;
  canonicalWord: string;
  canonicalMsaSynonyms: string[];
  canonicalExplanation: string | null;
  localDialectLabel: string;
  mainGroupCode: MainDialectGroupCode | null;
  mainGroupLabelAr: string | null;
  category: string | null;
  categoryLabelAr: string | null;
  examples: { sentence: string }[];
  updatedAt: string;
}

export interface DialectWordsPage {
  rows: DialectWordEntry[];
  total: number;
}

export interface GetDialectWordsParams {
  mainGroupCode?: MainDialectGroupCode | null;
  search?: string;
  category?: string;
  sort?: "newest" | "alphabetical";
  limit?: number;
  offset?: number;
}

/** Approved-only public explorer listing. Never reads raw submissions. */
export async function getDialectWords(
  params: GetDialectWordsParams,
): Promise<DialectWordsPage> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("public_dialect_words", {
    p_main_group_code: params.mainGroupCode ?? null,
    p_search: params.search?.trim() || null,
    p_category: params.category || null,
    p_sort: params.sort ?? "newest",
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  });
  if (error) throw error;

  const source = data ?? [];
  const rows = source.map((row) => ({
    id: row.id,
    canonicalWord: row.canonical_word,
    canonicalMsaSynonyms: row.canonical_msa_synonyms,
    canonicalExplanation: row.canonical_explanation,
    localDialectLabel: row.local_dialect_label,
    mainGroupCode: row.main_group_code,
    mainGroupLabelAr: row.main_group_label_ar,
    category: row.category,
    categoryLabelAr: row.category_label_ar,
    examples: row.examples ?? [],
    updatedAt: row.updated_at,
  }));

  return { rows, total: source[0]?.total_count ?? 0 };
}
