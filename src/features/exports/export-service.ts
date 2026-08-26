import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  MAIN_GROUP_LABELS_AR,
  MAIN_GROUP_ORDER,
  projectToExportV4,
  type CanonicalEntryForExport,
} from "./projection";
import type { MainDialectGroupCode } from "@/lib/supabase/types";

/**
 * Admin export visibility filter — distinct from the public-facing
 * approved+public rule. "all" (the default) intentionally includes both
 * public and private approved records: an approved-private word is still
 * reviewed, useful data that belongs in an authorized admin export and
 * future model-training data, even though it must never reach any public
 * surface (see public_dialect_words()/public_dialect_leaderboard(), which
 * hard-filter to public_visibility = 'public').
 */
export type ExportVisibilityFilter = "all" | "public" | "private";

export interface ExportFilters {
  dialectId?: string;
  /** v4/ALLaM only: filters by the stable 5-group taxonomy directly, independent of `dialectId` (a specific dialects.id row). Applied in application code — see below. */
  mainGroupCode?: MainDialectGroupCode;
  updatedFrom?: string;
  updatedTo?: string;
  visibility?: ExportVisibilityFilter;
}

export async function fetchApprovedEntries(
  filters: ExportFilters,
): Promise<CanonicalEntryForExport[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("canonical_entries")
    .select(
      "*, dialects!canonical_entries_canonical_dialect_id_fkey(name_ar, main_group_code, parent_id), canonical_examples(id, sentence, position), reference_prompts(id, category, category_label_ar, msa_lemma), entry_sources(raw_submission_id), canonical_entry_dialects(dialects(name_ar, main_group_code, parent_id))",
    )
    .eq("editorial_status", "approved");

  if (filters.dialectId)
    query = query.eq("canonical_dialect_id", filters.dialectId);
  if (filters.updatedFrom) query = query.gte("updated_at", filters.updatedFrom);
  if (filters.updatedTo) query = query.lte("updated_at", filters.updatedTo);
  if (filters.visibility && filters.visibility !== "all")
    query = query.eq("public_visibility", filters.visibility);

  const { data, error } = await query;
  if (error) throw error;

  // Cast once: the hand-maintained Database type doesn't model foreign-key
  // Relationships, so embedded selects (`dialects(...)`, `canonical_examples(...)`)
  // infer as an error type. See types.ts.
  const rows = (data ?? []) as unknown as {
    id: string;
    canonical_word: string;
    canonical_word_search_key: string;
    canonical_msa_synonyms: string[];
    canonical_explanation: string | null;
    approved_at: string | null;
    updated_at: string;
    concept_id: string | null;
    register: string | null;
    related_words: string[] | null;
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
    canonical_entry_dialects: {
      dialects: {
        name_ar: string;
        main_group_code: string | null;
        parent_id: string | null;
      } | null;
    }[];
  }[];

  const mapped = rows.map((row) => {
    // v4/ALLaM read the full multi-dialect set (the dictionary editor can
    // link more than one main group and/or local dialect); always unioned
    // with the row's own primary `canonical_dialect_id` join so an entry
    // never touched by the editor (approved via the older single-dialect
    // approve/merge path) still reports its one dialect correctly — same
    // union rule as dictionary_entries_list()/dictionary_entry_detail() in
    // migration 0027.
    const allDialects = [
      row.dialects,
      ...row.canonical_entry_dialects.map((d) => d.dialects),
    ].filter((d): d is NonNullable<typeof d> => d !== null);
    // Sorted deterministically (not insertion order, which follows
    // whatever row order Postgres happens to return the join in — not
    // guaranteed stable across two executions of an unchanged query) so
    // repeated exports of unchanged data are byte-identical, per the v4
    // export's determinism contract.
    const mainGroupCodes = [
      ...new Set(
        allDialects
          .map((d) => d.main_group_code)
          .filter((c): c is string => c !== null),
      ),
    ].sort(
      (a, b) =>
        (MAIN_GROUP_ORDER as readonly string[]).indexOf(a) -
        (MAIN_GROUP_ORDER as readonly string[]).indexOf(b),
    );
    const localLabels = [
      ...new Set(allDialects.filter((d) => d.parent_id).map((d) => d.name_ar)),
    ].sort((a, b) => a.localeCompare(b, "ar"));

    return {
      id: row.id,
      canonical_word: row.canonical_word,
      canonical_word_search_key: row.canonical_word_search_key,
      canonical_dialect_name: row.dialects?.name_ar ?? "",
      canonical_msa_synonyms: row.canonical_msa_synonyms ?? [],
      canonical_explanation: row.canonical_explanation,
      approved_at: row.approved_at,
      updated_at: row.updated_at,
      examples: (row.canonical_examples ?? [])
        .sort((a, b) => a.position - b.position)
        .map((e) => ({ id: e.id, sentence: e.sentence })),
      // Singular fields (v1/v2/v3 contract): the entry's primary dialect only.
      main_group_code: row.dialects?.main_group_code ?? null,
      main_group_label_ar: row.dialects?.main_group_code
        ? (MAIN_GROUP_LABELS_AR[row.dialects.main_group_code] ?? null)
        : null,
      local_labels: row.dialects?.parent_id ? [row.dialects.name_ar] : [],
      // Plural fields (v4): the full multi-dialect set from the editor.
      main_group_codes: mainGroupCodes,
      local_dialect_labels: localLabels,
      reference_concept: row.reference_prompts
        ? {
            id: row.reference_prompts.id,
            category: row.reference_prompts.category,
            category_label_ar: row.reference_prompts.category_label_ar,
            msa_lemma: row.reference_prompts.msa_lemma,
          }
        : null,
      source_count: Math.max(1, (row.entry_sources ?? []).length),
      concept_id: row.concept_id,
      register: row.register,
      related_words: row.related_words ?? [],
    };
  });

  // Applied in application code, not the query builder: `mainGroupCode`
  // filters the stable 5-group taxonomy directly, independent of the
  // specific `dialects.id` row `dialectId` targets, and this keeps that
  // logic testable without a live database (see export.test.ts's "all
  // dialects never inherits a stale filter" regression coverage).
  if (filters.mainGroupCode) {
    return mapped.filter((e) => e.main_group_code === filters.mainGroupCode);
  }
  return mapped;
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

export interface ExportV4ValidationSummary {
  recordCount: number;
  countsByMainDialect: Record<string, number>;
  missingMeaningCount: number;
  missingSynonymCount: number;
  excludedInvalidExampleCount: number;
  excludedEntries: { id: string; word: string }[];
}

/**
 * v4-specific validation/preview summary, computed from the same
 * `fetchApprovedEntries` + `projectToExportV4` pipeline the actual download
 * uses, so the preview panel can never disagree with what gets downloaded.
 */
export async function getExportV4ValidationSummary(
  filters: ExportFilters,
): Promise<ExportV4ValidationSummary> {
  const entries = await fetchApprovedEntries(filters);
  const { records, excluded } = projectToExportV4(entries);

  const countsByMainDialect: Record<string, number> = {};
  for (const record of records) {
    for (const code of record.dialects) {
      countsByMainDialect[code] = (countsByMainDialect[code] ?? 0) + 1;
    }
  }

  return {
    recordCount: records.length,
    countsByMainDialect,
    missingMeaningCount: records.filter((r) => r.meaning === null).length,
    missingSynonymCount: records.filter((r) => r.msa_synonyms.length === 0)
      .length,
    excludedInvalidExampleCount: excluded.length,
    excludedEntries: excluded.map((e) => ({ id: e.id, word: e.word })),
  };
}

export async function logExport(params: {
  format: "json" | "jsonl" | "allam-jsonl";
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
