"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { toSearchKey } from "@/lib/text/normalize-arabic";
import type { Database, ReviewStatus } from "@/lib/supabase/types";

const PAGE_SIZE = 25;

type RawExampleRow = Database["public"]["Tables"]["raw_examples"]["Row"];
type RawSubmissionRow =
  Database["public"]["Tables"]["raw_word_submissions"]["Row"];
/** Shape of a raw submission with its embedded examples, as returned by `.select("*, raw_examples(*)")`. Cast explicitly here because the hand-maintained Database type doesn't model foreign-key relationships (see types.ts). */
export type RawSubmissionWithExamples = RawSubmissionRow & {
  raw_examples: RawExampleRow[];
};

export interface ListSubmissionsParams {
  page?: number;
  status?: ReviewStatus;
  search?: string;
  sortBy?: "created_at" | "submitted_word" | "submitted_dialect";
  sortDir?: "asc" | "desc";
}

export async function getDashboardCounts() {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_dashboard_counts", {
    p_admin: admin.userId,
  });
  if (error) throw error;
  return data as {
    new: number;
    pending: number;
    approved: number;
    rejected: number;
    duplicate: number;
    merged: number;
    total: number;
    unseen: number;
    latest_export: {
      created_at: string;
      format: string;
      record_count: number;
    } | null;
  };
}

export async function listSubmissions(params: ListSubmissionsParams) {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const page = params.page ?? 1;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("raw_word_submissions")
    .select("*, raw_examples(*)", { count: "exact" });

  if (params.status) query = query.eq("review_status", params.status);
  if (params.search) {
    const key = toSearchKey(params.search);
    query = query.or(
      `word_search_key.ilike.%${key}%,dialect_search_key.ilike.%${key}%`,
    );
  }

  const sortBy = params.sortBy ?? "created_at";
  const sortDir = params.sortDir ?? "desc";
  query = query.order(sortBy, { ascending: sortDir === "asc" }).range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;
  return {
    rows: (data ?? []) as unknown as RawSubmissionWithExamples[],
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
  };
}

export interface CanonicalLinkStatus {
  entryId: string;
  editorialStatus: string;
  exampleCount: number;
}

export async function getSubmissionDetail(id: string) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const [
    { data: submission, error },
    { data: history },
    { data: duplicates },
    { data: link },
  ] = await Promise.all([
    supabase
      .from("raw_word_submissions")
      .select("*, raw_examples(*)")
      .eq("id", id)
      .single(),
    supabase
      .from("review_events")
      .select("*")
      .eq("raw_submission_id", id)
      .order("created_at", { ascending: false }),
    supabase.rpc("duplicate_candidates", { p_submission_id: id }),
    supabase
      .from("entry_sources")
      .select(
        "canonical_entry_id, canonical_entries(editorial_status, canonical_examples(id))",
      )
      .eq("raw_submission_id", id)
      .eq("relation", "primary")
      .maybeSingle(),
  ]);
  if (error) throw error;

  await supabase.rpc("mark_submission_seen", {
    p_admin: admin.userId,
    p_submission: id,
  });

  // Cast: embedded-select typing gap, same as elsewhere in this file (see
  // RawSubmissionWithExamples above).
  const linkRow = link as unknown as {
    canonical_entry_id: string;
    canonical_entries: {
      editorial_status: string;
      canonical_examples: { id: string }[];
    } | null;
  } | null;

  const canonicalStatus: CanonicalLinkStatus | null = linkRow?.canonical_entries
    ? {
        entryId: linkRow.canonical_entry_id,
        editorialStatus: linkRow.canonical_entries.editorial_status,
        exampleCount: linkRow.canonical_entries.canonical_examples.length,
      }
    : null;

  return {
    submission: submission as unknown as RawSubmissionWithExamples,
    history: history ?? [],
    duplicates: duplicates ?? [],
    canonicalStatus,
  };
}

export async function getSubmissionsByIds(ids: string[]) {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("raw_word_submissions")
    .select("*, raw_examples(*)")
    .in("id", ids);
  if (error) throw error;
  return (data ?? []) as unknown as RawSubmissionWithExamples[];
}

export async function setReviewStatus(
  submissionId: string,
  newStatus: Exclude<ReviewStatus, "approved">,
  expectedUpdatedAt: string | null,
) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("review_raw_submission", {
      p_actor: admin.userId,
      p_submission_id: submissionId,
      p_new_status: newStatus,
      p_expected_updated_at: expectedUpdatedAt,
    })
    .single();
  if (error) throw error;
  return data as {
    id: string;
    review_status: string;
    updated_at: string;
    stale: boolean;
  };
}

export async function bulkSetReviewStatus(
  submissionIds: string[],
  newStatus: Exclude<ReviewStatus, "approved">,
) {
  const results = await Promise.all(
    submissionIds.map((id) => setReviewStatus(id, newStatus, null)),
  );
  return results;
}

/**
 * The only path that may mark a submission "approved". Unlike
 * setReviewStatus (a bare raw_word_submissions status flip), this performs
 * the complete canonicalization transaction: creates or promotes the linked
 * canonical entry to editorial_status = 'approved', copies the raw
 * submission's examples onto it, and only then flips review_status. See
 * migration 0017 — a prior split between "classify" and "approve" left
 * approved-looking submissions with no exportable canonical record.
 */
export async function approveSubmission(input: {
  submissionId: string;
  dialectId: string;
  expectedUpdatedAt: string | null;
  /** When provided, overrides the raw submission's own word/synonyms/explanation (the ReviewDetail edit flow). Omit to use the raw values as-is (bulk quick-approve). */
  canonicalEdit?: {
    word: string;
    msaSynonyms: string[];
    explanation: string;
  };
}) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("approve_raw_submission", {
      p_actor: admin.userId,
      p_submission_id: input.submissionId,
      p_dialect_id: input.dialectId,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_use_raw_defaults: !input.canonicalEdit,
      p_canonical_word: input.canonicalEdit?.word ?? null,
      p_canonical_word_search_key: input.canonicalEdit
        ? toSearchKey(input.canonicalEdit.word)
        : null,
      p_canonical_msa_synonyms: input.canonicalEdit?.msaSynonyms ?? null,
      p_canonical_explanation: input.canonicalEdit?.explanation ?? null,
    })
    .single();
  if (error) throw error;
  return data as {
    entry_id: string | null;
    review_status: string;
    updated_at: string;
    stale: boolean;
  };
}

export async function bulkApproveSubmissions(
  submissionIds: string[],
  dialectId: string,
) {
  const results = await Promise.all(
    submissionIds.map((id) =>
      approveSubmission({
        submissionId: id,
        dialectId,
        expectedUpdatedAt: null,
      }),
    ),
  );
  return results;
}

export async function listDialects() {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("dialects")
    .select("*")
    .eq("is_active", true)
    .order("name_ar");
  if (error) throw error;
  return data ?? [];
}

export async function createDialect(
  nameAr: string,
  parentId: string | null = null,
) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const slug = toSearchKey(nameAr).replace(/\s+/g, "-");
  const { data, error } = await supabase
    .rpc("create_dialect", {
      p_actor: admin.userId,
      p_name_ar: nameAr,
      p_slug: slug,
      p_parent_id: parentId,
    })
    .single();
  if (error) throw error;
  return data;
}

export async function createDialectAlias(aliasAr: string, dialectId: string) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("create_dialect_alias", {
      p_actor: admin.userId,
      p_alias_ar: aliasAr,
      p_dialect_id: dialectId,
    })
    .single();
  if (error) throw error;
  return data;
}

export interface UpsertCanonicalInput {
  entryId: string | null;
  expectedVersion: number | null;
  word: string;
  dialectId: string;
  msaSynonyms: string[];
  explanation: string;
  editorialStatus: "draft" | "approved" | "retired";
  /** Only where semantically correct — set from the source raw submission's own link, never forced. */
  referencePromptId?: string | null;
}

export async function upsertCanonicalEntry(input: UpsertCanonicalInput) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("upsert_canonical_entry", {
      p_actor: admin.userId,
      p_entry_id: input.entryId,
      p_expected_version: input.expectedVersion,
      p_canonical_word: input.word,
      p_canonical_word_search_key: toSearchKey(input.word),
      p_canonical_dialect_id: input.dialectId,
      p_canonical_msa_synonyms: input.msaSynonyms,
      p_canonical_explanation: input.explanation,
      p_editorial_status: input.editorialStatus,
      p_reference_prompt_id: input.referencePromptId ?? null,
    })
    .single();
  if (error) throw error;
  return data as { id: string; version: number; stale: boolean };
}

export interface MergeInput {
  rawSubmissionIds: string[];
  targetEntryId: string | null;
  word: string;
  dialectId: string;
  msaSynonyms: string[];
  explanation: string;
  examples: {
    sentence: string;
    sourceRawExampleId: string | null;
    position: number;
  }[];
  referencePromptId?: string | null;
}

export async function mergeSubmissions(input: MergeInput) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("merge_submissions", {
    p_actor: admin.userId,
    p_raw_submission_ids: input.rawSubmissionIds,
    p_target_entry_id: input.targetEntryId,
    p_canonical_word: input.word,
    p_canonical_word_search_key: toSearchKey(input.word),
    p_canonical_dialect_id: input.dialectId,
    p_canonical_msa_synonyms: input.msaSynonyms,
    p_canonical_explanation: input.explanation,
    p_examples: input.examples.map((e) => ({
      sentence: e.sentence,
      sentenceSearchKey: toSearchKey(e.sentence),
      sourceRawExampleId: e.sourceRawExampleId,
      position: e.position,
    })),
    p_reference_prompt_id: input.referencePromptId ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function classifySubmissions(
  submissionIds: string[],
  dialectId: string,
) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const results = await Promise.all(
    submissionIds.map((id) =>
      supabase.rpc("classify_submission", {
        p_actor: admin.userId,
        p_submission_id: id,
        p_dialect_id: dialectId,
      }),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
  return results.map((r) => r.data as string);
}

export async function undoReviewEvent(eventId: string) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("undo_review_event", {
    p_actor: admin.userId,
    p_event_id: eventId,
  });
  if (error) throw error;
}
