"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { toSearchKey } from "@/lib/text/normalize-arabic";
import {
  planBulkApproval,
  type BulkApprovalSourceRow,
  type DialectTaxonomyRow,
} from "./bulk-approve";
import type {
  Database,
  MainDialectGroupCode,
  ParticipationExclusionReason,
  PublicVisibility,
  ReviewStatus,
} from "@/lib/supabase/types";

const PAGE_SIZE = 25;

type RawExampleRow = Database["public"]["Tables"]["raw_examples"]["Row"];
type RawSubmissionRow =
  Database["public"]["Tables"]["raw_word_submissions"]["Row"];
interface PrimaryCanonicalLink {
  relation: string;
  canonical_entries: {
    id: string;
    public_visibility: PublicVisibility;
    version: number;
  } | null;
}

/** Shape of a raw submission with its embedded examples, as returned by `.select("*, raw_examples(*)")`. Cast explicitly here because the hand-maintained Database type doesn't model foreign-key relationships (see types.ts). */
export type RawSubmissionWithExamples = RawSubmissionRow & {
  raw_examples: RawExampleRow[];
  /** Only populated when explicitly requested (see listSubmissions' visibility-badge join) — the row's linked canonical entry, if any, via its primary source link. */
  entry_sources?: PrimaryCanonicalLink[];
};

export interface ListSubmissionsParams {
  page?: number;
  status?: ReviewStatus;
  /** Only meaningful alongside status: "approved" — filters to canonical entries currently public vs. private. */
  visibility?: PublicVisibility;
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
    unclassified_participation: number;
    excluded_participation: number;
  };
}

export async function listSubmissions(params: ListSubmissionsParams) {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const page = params.page ?? 1;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // Approved rows always carry their canonical entry's visibility for the
  // grid's badge; an inner join (with an explicit relation/visibility
  // filter) is only used when a visibility filter is actually requested, so
  // "كل الحالات" never silently drops rows that lack a linked entry yet.
  const wantsVisibilityFilter =
    params.status === "approved" && Boolean(params.visibility);
  let query = supabase
    .from("raw_word_submissions")
    .select(
      wantsVisibilityFilter
        ? "*, raw_examples(*), entry_sources!inner(relation, canonical_entries!inner(id, public_visibility, version))"
        : "*, raw_examples(*), entry_sources(relation, canonical_entries(id, public_visibility, version))",
      { count: "exact" },
    );

  if (params.status) query = query.eq("review_status", params.status);
  if (wantsVisibilityFilter) {
    query = query
      .eq("entry_sources.relation", "primary")
      .eq(
        "entry_sources.canonical_entries.public_visibility",
        params.visibility!,
      );
  }
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
  publicVisibility: PublicVisibility;
  version: number;
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
        "canonical_entry_id, canonical_entries(editorial_status, public_visibility, version, canonical_examples(id))",
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
      public_visibility: PublicVisibility;
      version: number;
      canonical_examples: { id: string }[];
    } | null;
  } | null;

  const canonicalStatus: CanonicalLinkStatus | null = linkRow?.canonical_entries
    ? {
        entryId: linkRow.canonical_entry_id,
        editorialStatus: linkRow.canonical_entries.editorial_status,
        exampleCount: linkRow.canonical_entries.canonical_examples.length,
        publicVisibility: linkRow.canonical_entries.public_visibility,
        version: linkRow.canonical_entries.version,
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
  /** "public" (default) matches the pre-existing behavior; "private" keeps the word reviewed and exportable but off every public surface. */
  visibility?: PublicVisibility;
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
      p_visibility: input.visibility ?? "public",
    })
    .single();
  if (error) throw error;
  return data as {
    entry_id: string | null;
    review_status: string;
    updated_at: string;
    stale: boolean;
    public_visibility: PublicVisibility | null;
  };
}

export async function bulkApproveSubmissions(
  submissionIds: string[],
  dialectId: string,
  visibility: PublicVisibility = "public",
) {
  const results = await Promise.all(
    submissionIds.map((id) =>
      approveSubmission({
        submissionId: id,
        dialectId,
        expectedUpdatedAt: null,
        visibility,
      }),
    ),
  );
  return results;
}

export interface BulkApprovalRowResult {
  submissionId: string;
  status: "approved" | "needs_attention" | "failed";
  reason?:
    | "empty_label"
    | "group_conflict"
    | "ambiguous"
    | "invalid_trusted_dialect"
    | "missing_classification"
    | "stale";
  entryId?: string | null;
}

export interface BulkApprovalOutcome {
  approvedCount: number;
  needsAttentionCount: number;
  reusedDialectCount: number;
  createdDialectCount: number;
  mainGroupOnlyCount: number;
  rows: BulkApprovalRowResult[];
}

function toSourceRows(
  submissionIds: string[],
  bySubmissionId: Map<string, RawSubmissionWithExamples>,
): BulkApprovalSourceRow[] {
  return submissionIds
    .map((id) => bySubmissionId.get(id))
    .filter((s): s is RawSubmissionWithExamples => Boolean(s))
    .map((s) => ({
      submissionId: s.id,
      submittedDialect: s.submitted_dialect,
      selectedDialectId: s.selected_dialect_id,
      provisionalMainGroupCode: s.provisional_main_group_code,
    }));
}

function toTaxonomyRows(
  dialectRows: Awaited<ReturnType<typeof listDialects>>,
): DialectTaxonomyRow[] {
  return dialectRows.map((d) => ({
    id: d.id,
    nameAr: d.name_ar,
    parentId: d.parent_id,
    mainGroupCode: d.main_group_code,
    isActive: d.is_active,
  }));
}

/**
 * Loads everything planBulkApproval() needs: each submission's own
 * classification signal (selected_dialect_id / provisional_main_group_code
 * — set by the contribution form, see migration 0019) and the active
 * dialect taxonomy. There is deliberately no admin-chosen batch group here
 * — every row resolves from its own data.
 */
async function loadBulkApprovalPlan(submissionIds: string[]) {
  const [submissions, dialectRows] = await Promise.all([
    getSubmissionsByIds(submissionIds),
    listDialects(),
  ]);
  const bySubmissionId = new Map(submissions.map((s) => [s.id, s]));
  const plan = planBulkApproval(
    toSourceRows(submissionIds, bySubmissionId),
    toTaxonomyRows(dialectRows),
  );
  return { plan, bySubmissionId, dialectRows };
}

/**
 * Creates every proposed new local dialect once, up front —
 * create_dialect() is idempotent on a slug collision (see migration 0022),
 * so a retry of the whole batch never produces a duplicate taxonomy row.
 * Each proposal already carries its own main group (a mixed batch can
 * propose new local labels under several different groups at once).
 */
async function materializeNewDialects(
  admin: { userId: string },
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  plan: Awaited<ReturnType<typeof planBulkApproval>>,
  dialectRows: Awaited<ReturnType<typeof listDialects>>,
): Promise<Map<string, string>> {
  const mainGroupDialectByCode = new Map(
    dialectRows
      .filter((d) => d.parent_id === null && d.main_group_code)
      .map((d) => [d.main_group_code as string, d.id]),
  );
  const createdDialectIdByKey = new Map<string, string>();
  for (const proposal of plan.newDialects) {
    const { data, error } = await supabase
      .rpc("create_dialect", {
        p_actor: admin.userId,
        p_name_ar: proposal.label,
        p_slug: proposal.slug,
        p_parent_id: mainGroupDialectByCode.get(proposal.mainGroupCode) ?? null,
      })
      .single();
    if (error) throw error;
    createdDialectIdByKey.set(proposal.key, (data as { id: string }).id);
  }
  return createdDialectIdByKey;
}

/** Resolves a plan row (or its admin override) to a concrete dialect id, or null if it's genuinely unresolved. */
function resolveDialectId(
  rowPlan: ReturnType<typeof planBulkApproval>["rowPlans"][number],
  override: string | undefined,
  createdDialectIdByKey: Map<string, string>,
): string | null {
  if (override) return override;
  if (rowPlan.kind === "needs_attention") return null;
  if (rowPlan.kind === "create_local")
    return createdDialectIdByKey.get(rowPlan.key) ?? null;
  return rowPlan.dialectId;
}

/**
 * Fast bulk-approval flow: every selected word classifies and approves
 * itself from its own submitted-dialect information — a trusted selected
 * dialect, a directly-selected main group, or a custom label with its own
 * provisional group (see bulk-approve.ts for the full decision rules).
 * A selected batch may span every main group at once; there is no
 * admin-chosen batch group. Every actual write still goes through the
 * existing narrow, security-definer RPCs (create_dialect,
 * approve_raw_submission) — this only orchestrates them, it never writes to
 * a table directly.
 */
export async function bulkApproveWithSubmittedDialects(
  submissionIds: string[],
  visibility: PublicVisibility,
  /** Per-row admin override (submissionId -> dialectId), the exception path for a row the default resolution got wrong — bypasses that row's plan entirely, including any "needs_attention" flag. */
  overrides: Record<string, string> = {},
): Promise<BulkApprovalOutcome> {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const { plan, bySubmissionId, dialectRows } =
    await loadBulkApprovalPlan(submissionIds);
  const createdDialectIdByKey = await materializeNewDialects(
    admin,
    supabase,
    plan,
    dialectRows,
  );

  const rows: BulkApprovalRowResult[] = [];
  let reusedDialectCount = 0;
  let createdDialectCount = 0;
  let mainGroupOnlyCount = 0;

  for (const rowPlan of plan.rowPlans) {
    const override = overrides[rowPlan.submissionId];
    const dialectId = resolveDialectId(
      rowPlan,
      override,
      createdDialectIdByKey,
    );

    if (!dialectId) {
      rows.push({
        submissionId: rowPlan.submissionId,
        status: "needs_attention",
        reason:
          rowPlan.kind === "needs_attention" ? rowPlan.reason : "ambiguous",
      });
      continue;
    }

    if (override) {
      // Overridden rows aren't counted toward the default reuse/create/
      // main-group buckets — the admin explicitly picked this dialect.
    } else if (rowPlan.kind === "trusted_local") reusedDialectCount += 1;
    else if (rowPlan.kind === "create_local") createdDialectCount += 1;
    else if (rowPlan.kind === "main_group") mainGroupOnlyCount += 1;

    const submission = bySubmissionId.get(rowPlan.submissionId);
    const result = await approveSubmission({
      submissionId: rowPlan.submissionId,
      dialectId,
      expectedUpdatedAt: submission?.updated_at ?? null,
      visibility,
    });

    if (result.stale) {
      rows.push({
        submissionId: rowPlan.submissionId,
        status: "needs_attention",
        reason: "stale",
      });
      continue;
    }

    rows.push({
      submissionId: rowPlan.submissionId,
      status: "approved",
      entryId: result.entry_id,
    });
  }

  return {
    approvedCount: rows.filter((r) => r.status === "approved").length,
    needsAttentionCount: rows.filter((r) => r.status !== "approved").length,
    reusedDialectCount,
    createdDialectCount,
    mainGroupOnlyCount,
    rows,
  };
}

/**
 * Classification-only counterpart of bulkApproveWithSubmittedDialects():
 * resolves each row the same way and applies the classification (creating
 * new local dialects as needed) without approving anything — the raw
 * submission's review_status only moves 'new' → 'pending' (see
 * classify_submission()), never to 'approved'.
 */
export async function classifyWithSubmittedDialects(
  submissionIds: string[],
  overrides: Record<string, string> = {},
): Promise<BulkApprovalOutcome> {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const { plan, dialectRows } = await loadBulkApprovalPlan(submissionIds);
  const createdDialectIdByKey = await materializeNewDialects(
    admin,
    supabase,
    plan,
    dialectRows,
  );

  const rows: BulkApprovalRowResult[] = [];
  let reusedDialectCount = 0;
  let createdDialectCount = 0;
  let mainGroupOnlyCount = 0;

  for (const rowPlan of plan.rowPlans) {
    const override = overrides[rowPlan.submissionId];
    const dialectId = resolveDialectId(
      rowPlan,
      override,
      createdDialectIdByKey,
    );

    if (!dialectId) {
      rows.push({
        submissionId: rowPlan.submissionId,
        status: "needs_attention",
        reason:
          rowPlan.kind === "needs_attention" ? rowPlan.reason : "ambiguous",
      });
      continue;
    }

    if (override) {
      // no bucket credit — see bulkApproveWithSubmittedDialects
    } else if (rowPlan.kind === "trusted_local") reusedDialectCount += 1;
    else if (rowPlan.kind === "create_local") createdDialectCount += 1;
    else if (rowPlan.kind === "main_group") mainGroupOnlyCount += 1;

    const { error } = await supabase.rpc("classify_submission", {
      p_actor: admin.userId,
      p_submission_id: rowPlan.submissionId,
      p_dialect_id: dialectId,
    });
    if (error) {
      rows.push({
        submissionId: rowPlan.submissionId,
        status: "failed",
      });
      continue;
    }

    rows.push({ submissionId: rowPlan.submissionId, status: "approved" });
  }

  return {
    approvedCount: rows.filter((r) => r.status === "approved").length,
    needsAttentionCount: rows.filter((r) => r.status !== "approved").length,
    reusedDialectCount,
    createdDialectCount,
    mainGroupOnlyCount,
    rows,
  };
}

/**
 * Read-only preview of what bulkApproveWithSubmittedDialects() /
 * classifyWithSubmittedDialects() would do, for the grid's compact
 * readiness line and per-row override affordance — never creates a dialect
 * or approves/classifies anything itself.
 */
export async function previewBulkApproval(submissionIds: string[]) {
  await requireAdmin();
  const { plan } = await loadBulkApprovalPlan(submissionIds);
  return plan;
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

/**
 * The only lever that removes a legitimate-looking submission from
 * submission_count (spam/abuse/test/duplicate/invalid_submission). An
 * ordinary public rejection must never go through this path — participation
 * and public-dictionary eligibility are independent decisions. Pass null to
 * restore participation (undo).
 */
export async function setParticipationExclusion(
  submissionId: string,
  reason: ParticipationExclusionReason | null,
) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("set_submission_participation_exclusion", {
      p_actor: admin.userId,
      p_submission_id: submissionId,
      p_reason: reason,
    })
    .single();
  if (error) throw error;
  return data;
}

export async function bulkSetParticipationExclusion(
  submissionIds: string[],
  reason: ParticipationExclusionReason | null,
) {
  const results = await Promise.all(
    submissionIds.map((id) => setParticipationExclusion(id, reason)),
  );
  return results;
}

/**
 * Admin override of which main group a raw submission's participation
 * counts toward. Independent of canonical dialect classification — this
 * only affects the leaderboard's live attribution (see
 * public_dialect_leaderboard, migration 0019), and takes effect
 * immediately since counts are always derived, never cached.
 */
export async function setSubmissionMainGroup(
  submissionId: string,
  mainGroupCode: MainDialectGroupCode | null,
) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("set_submission_main_group", {
      p_actor: admin.userId,
      p_submission_id: submissionId,
      p_main_group_code: mainGroupCode,
    })
    .single();
  if (error) throw error;
  return data;
}

/**
 * Toggles an already-approved canonical entry between public and private
 * without touching canonical data, source links, or examples. Optimistic
 * concurrency on `version`; auditable and undoable through the same
 * review_events/undo_review_event() path as every other editorial action.
 */
export async function setCanonicalVisibility(
  entryId: string,
  visibility: PublicVisibility,
  expectedVersion: number | null,
) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("set_canonical_visibility", {
      p_actor: admin.userId,
      p_entry_id: entryId,
      p_visibility: visibility,
      p_expected_version: expectedVersion,
    })
    .single();
  if (error) throw error;
  return data as {
    id: string;
    public_visibility: PublicVisibility;
    version: number;
    stale: boolean;
  };
}

export async function bulkSetCanonicalVisibility(
  entryIds: string[],
  visibility: PublicVisibility,
) {
  const results = await Promise.all(
    entryIds.map((id) => setCanonicalVisibility(id, visibility, null)),
  );
  return results;
}

export async function bulkSetSubmissionMainGroup(
  submissionIds: string[],
  mainGroupCode: MainDialectGroupCode,
) {
  const results = await Promise.all(
    submissionIds.map((id) => setSubmissionMainGroup(id, mainGroupCode)),
  );
  return results;
}
