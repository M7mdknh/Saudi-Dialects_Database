import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import type { CanonicalEntryForExport } from "./projection";

export interface ExportFilters {
  dialectId?: string;
  updatedFrom?: string;
  updatedTo?: string;
}

export async function fetchApprovedEntries(
  filters: ExportFilters,
): Promise<CanonicalEntryForExport[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("canonical_entries")
    .select("*, dialects(name_ar), canonical_examples(sentence, position)")
    .eq("editorial_status", "approved");

  if (filters.dialectId)
    query = query.eq("canonical_dialect_id", filters.dialectId);
  if (filters.updatedFrom) query = query.gte("updated_at", filters.updatedFrom);
  if (filters.updatedTo) query = query.lte("updated_at", filters.updatedTo);

  const { data, error } = await query;
  if (error) throw error;

  // Cast once: the hand-maintained Database type doesn't model foreign-key
  // Relationships, so embedded selects (`dialects(...)`, `canonical_examples(...)`)
  // infer as an error type. See types.ts.
  const rows = (data ?? []) as unknown as {
    id: string;
    canonical_word: string;
    canonical_msa_synonyms: string[];
    canonical_explanation: string | null;
    approved_at: string | null;
    updated_at: string;
    dialects: { name_ar: string } | null;
    canonical_examples: { sentence: string; position: number }[];
  }[];

  return rows.map((row) => ({
    id: row.id,
    canonical_word: row.canonical_word,
    canonical_dialect_name: row.dialects?.name_ar ?? "",
    canonical_msa_synonyms: row.canonical_msa_synonyms ?? [],
    canonical_explanation: row.canonical_explanation,
    approved_at: row.approved_at,
    updated_at: row.updated_at,
    examples: (row.canonical_examples ?? [])
      .sort((a, b) => a.position - b.position)
      .map((e) => ({ sentence: e.sentence })),
  }));
}

export async function logExport(params: {
  format: "json" | "jsonl";
  schemaVersion: number;
  filters: ExportFilters;
  recordCount: number;
  checksum: string;
}) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_export", {
    p_actor: admin.userId,
    p_format: params.format,
    p_schema_version: params.schemaVersion,
    p_filters: params.filters,
    p_record_count: params.recordCount,
    p_checksum: params.checksum,
  });
  if (error) throw error;
}
