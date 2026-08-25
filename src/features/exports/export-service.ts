import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  MAIN_GROUP_LABELS_AR,
  type CanonicalEntryForExport,
} from "./projection";

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
    .select(
      "*, dialects(name_ar, main_group_code, parent_id), canonical_examples(id, sentence, position), reference_prompts(id, category, category_label_ar, msa_lemma), entry_sources(raw_submission_id)",
    )
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
    dialects: {
      name_ar: string;
      main_group_code: string | null;
      parent_id: string | null;
    } | null;
    canonical_examples: { id: string; sentence: string; position: number }[];
    reference_prompts: {
      id: string;
      category: string;
      category_label_ar: string;
      msa_lemma: string;
    } | null;
    entry_sources: { raw_submission_id: string }[];
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
      .map((e) => ({ id: e.id, sentence: e.sentence })),
    main_group_code: row.dialects?.main_group_code ?? null,
    main_group_label_ar: row.dialects?.main_group_code
      ? (MAIN_GROUP_LABELS_AR[row.dialects.main_group_code] ?? null)
      : null,
    // A main-group dialect row (parent_id null) IS the classification —
    // there is no more-specific local label to report. Only a local
    // dialect row (has a parent) contributes a local label.
    local_labels: row.dialects?.parent_id ? [row.dialects.name_ar] : [],
    reference_concept: row.reference_prompts
      ? {
          id: row.reference_prompts.id,
          category: row.reference_prompts.category,
          category_label_ar: row.reference_prompts.category_label_ar,
          msa_lemma: row.reference_prompts.msa_lemma,
        }
      : null,
    source_count: Math.max(1, (row.entry_sources ?? []).length),
  }));
}

export interface ExportEligibilitySummary {
  /** Approved canonical entries matching the current filters — must equal the preview/download record count. */
  eligibleCount: number;
  /** Approved canonical entries with no filters applied at all. */
  totalApprovedCount: number;
  /** Within the eligible (filtered) set: entries with an empty msa_synonyms array. Never a reason for exclusion. */
  missingSynonymCount: number;
  /** Canonical entries classified (a dialect is assigned) but not yet approved — invisible to every export version until approved. */
  awaitingApprovalCount: number;
  /** How many approved entries the current filters remove, relative to the unfiltered total. */
  excludedByFiltersCount: number;
}

/**
 * One shared eligibility/diagnostic query, used by both the preview panel
 * and (implicitly, via the same filters) the download — so an admin never
 * sees a preview count that disagrees with what they actually download,
 * and an empty result always comes with an honest explanation instead of
 * a bare zero.
 */
export async function getExportEligibilitySummary(
  filters: ExportFilters,
): Promise<ExportEligibilitySummary> {
  const supabase = await createSupabaseServerClient();

  const [eligible, totalApproved, awaitingApproval] = await Promise.all([
    fetchApprovedEntries(filters),
    fetchApprovedEntries({}),
    supabase
      .from("canonical_entries")
      .select("id", { count: "exact", head: true })
      .eq("editorial_status", "draft"),
  ]);

  if (awaitingApproval.error) throw awaitingApproval.error;

  return {
    eligibleCount: eligible.length,
    totalApprovedCount: totalApproved.length,
    missingSynonymCount: eligible.filter(
      (e) => (e.canonical_msa_synonyms ?? []).length === 0,
    ).length,
    awaitingApprovalCount: awaitingApproval.count ?? 0,
    excludedByFiltersCount: totalApproved.length - eligible.length,
  };
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
