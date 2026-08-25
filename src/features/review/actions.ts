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

export async function getSubmissionDetail(id: string) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const [{ data: submission, error }, { data: history }, { data: duplicates }] =
    await Promise.all([
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
    ]);
  if (error) throw error;

  await supabase.rpc("mark_submission_seen", {
    p_admin: admin.userId,
    p_submission: id,
  });

  return {
    submission: submission as unknown as RawSubmissionWithExamples,
    history: history ?? [],
    duplicates: duplicates ?? [],
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
  newStatus: ReviewStatus,
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
  newStatus: ReviewStatus,
) {
  const results = await Promise.all(
    submissionIds.map((id) => setReviewStatus(id, newStatus, null)),
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
