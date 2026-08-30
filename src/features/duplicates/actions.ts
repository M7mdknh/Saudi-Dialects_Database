"use server";

import { createHash, randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { toSearchKey } from "@/lib/text/normalize-arabic";
import { AUTO_MERGE_BATCH_SIZE } from "./auto-merge-rules";
import type {
  DuplicateCandidateType,
  DuplicateGroupStatus,
  MainDialectGroupCode,
  PublicVisibility,
} from "@/lib/supabase/types";

const PAGE_SIZE = 20;

export interface DuplicateGroupRow {
  groupKey: string;
  candidateType: DuplicateCandidateType;
  word: string;
  wordSearchKey: string;
  candidateCount: number;
  mainGroupCodes: MainDialectGroupCode[];
  localDialectLabels: string[];
  meanings: string[];
  exampleCount: number;
  hasCanonical: boolean;
  canonicalEntryId: string | null;
  canonicalStatus: string | null;
  publicVisibility: PublicVisibility | null;
  resolutionStatus: DuplicateGroupStatus;
  newestCandidateAt: string;
  matchStrength: number;
  memberSignature: string;
  autoMergeable: boolean;
}

export interface ListDuplicateGroupsParams {
  page?: number;
  search?: string;
  candidateType?: DuplicateCandidateType;
  mainGroupCode?: MainDialectGroupCode;
  localDialectLabel?: string;
  minCandidates?: number;
  resolutionStatus?: DuplicateGroupStatus;
  sort?: "newest" | "largest" | "strongest";
}

/**
 * Must match the database's own signature exactly: md5 of the sorted,
 * comma-joined member ids (see duplicate_group_candidates' `member_ids`,
 * already returned pre-sorted by the query, and resolve/merge functions'
 * `computed_signature` comparison). This is what lets the UI's resolve/
 * merge calls round-trip a signature the database can verify still matches
 * the group's current membership — if a new submission joined the group
 * since the page loaded, the signature mismatches and the action is
 * rejected rather than resolving/merging a group that has since changed.
 */
function memberSignatureFromIds(memberIds: string[]): string {
  return createHash("md5").update(memberIds.join(",")).digest("hex");
}

export async function listDuplicateGroups(params: ListDuplicateGroupsParams) {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const page = params.page ?? 1;

  const { data, error } = await supabase.rpc("duplicate_group_candidates", {
    p_search: params.search?.trim() || null,
    p_candidate_type: params.candidateType ?? null,
    p_main_group_code: params.mainGroupCode ?? null,
    p_local_dialect_label: params.localDialectLabel ?? null,
    p_min_candidates: params.minCandidates ?? null,
    p_resolution_status: params.resolutionStatus ?? null,
    p_sort: params.sort ?? "newest",
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  if (error) throw error;

  const rows: DuplicateGroupRow[] = (data ?? []).map((row) => ({
    groupKey: row.group_key,
    candidateType: row.candidate_type,
    word: row.word,
    wordSearchKey: row.word_search_key,
    candidateCount: row.candidate_count,
    mainGroupCodes: row.main_group_codes ?? [],
    localDialectLabels: row.local_dialect_labels ?? [],
    meanings: row.meanings ?? [],
    exampleCount: row.example_count,
    hasCanonical: row.has_canonical,
    canonicalEntryId: row.canonical_entry_id,
    canonicalStatus: row.canonical_status,
    publicVisibility: row.public_visibility,
    resolutionStatus: row.resolution_status,
    newestCandidateAt: row.newest_candidate_at,
    matchStrength: row.match_strength,
    memberSignature: memberSignatureFromIds(row.member_ids ?? []),
    autoMergeable: row.auto_mergeable,
  }));

  return {
    rows,
    total: data?.[0]?.total_count ?? 0,
    page,
    pageSize: PAGE_SIZE,
  };
}

/** Single-group lookup, for the merge workspace (needs the group's current memberSignature/resolutionStatus/candidateType even though its member details come from getDuplicateGroupMembers). */
export async function getDuplicateGroupRow(
  groupKey: string,
): Promise<DuplicateGroupRow | null> {
  const { rows } = await listDuplicateGroups({ minCandidates: 2 });
  const found = rows.find((r) => r.groupKey === groupKey);
  if (found) return found;

  // Not on the first page of the default (unresolved-first) listing — fall
  // back to an unfiltered, unpaginated scan (same cost as
  // duplicate_group_members' own internal lookup).
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("duplicate_group_candidates", {
    p_search: null,
    p_candidate_type: null,
    p_main_group_code: null,
    p_local_dialect_label: null,
    p_min_candidates: null,
    p_resolution_status: null,
    p_sort: "newest",
    p_limit: 1000000,
    p_offset: 0,
  });
  if (error) throw error;
  const row = (data ?? []).find((r) => r.group_key === groupKey);
  if (!row) return null;
  return {
    groupKey: row.group_key,
    candidateType: row.candidate_type,
    word: row.word,
    wordSearchKey: row.word_search_key,
    candidateCount: row.candidate_count,
    mainGroupCodes: row.main_group_codes ?? [],
    localDialectLabels: row.local_dialect_labels ?? [],
    meanings: row.meanings ?? [],
    exampleCount: row.example_count,
    hasCanonical: row.has_canonical,
    canonicalEntryId: row.canonical_entry_id,
    canonicalStatus: row.canonical_status,
    publicVisibility: row.public_visibility,
    resolutionStatus: row.resolution_status,
    newestCandidateAt: row.newest_candidate_at,
    matchStrength: row.match_strength,
    memberSignature: memberSignatureFromIds(row.member_ids ?? []),
    autoMergeable: row.auto_mergeable,
  };
}

export async function getDuplicateSummary() {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("duplicate_group_summary")
    .single();
  if (error) throw error;
  return {
    unresolvedGroups: data.unresolved_groups,
    exactMatchGroups: data.exact_match_groups,
    possibleMatchGroups: data.possible_match_groups,
    totalSourceRecords: data.total_source_records,
  };
}

/** Preview count for the "دمج الحالات الواضحة تلقائيًا" batch action — read-only. */
export async function getAutoMergeableDuplicateCount(): Promise<number> {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(
    "count_auto_mergeable_duplicate_groups",
  );
  if (error) throw error;
  return data ?? 0;
}

export interface AutoMergeGroupOutcome {
  groupKey: string;
  entryId: string | null;
  merged: boolean;
  /** e.g. 'merged' | 'already_up_to_date' | 'conflict' | 'not_exact' | 'multiple_canonical_entries' | 'insufficient_sources' | 'already_resolved' | 'dialect_required' | 'error' */
  reason: string;
}

export interface AutoMergeFailure {
  groupKey: string;
  reason: string;
  /** Correlates this failure with the server-side console.error entry, for diagnosis without exposing internals to the admin. */
  referenceId: string;
}

export interface AutoMergeBatchResult {
  /** Count of eligible groups before this batch claimed any of them. */
  eligibleBefore: number;
  attempted: number;
  merged: number;
  skipped: number;
  failed: number;
  /** Eligible-group count recomputed after this batch — drives the client's continue/stop decision. */
  remaining: number;
  failedGroups: AutoMergeFailure[];
  outcomes: AutoMergeGroupOutcome[];
}

/**
 * Processes one bounded batch of the automatic-merge backlog:
 *
 *   1. Atomically claims up to `limit` eligible groups (`FOR UPDATE SKIP
 *      LOCKED` under the hood) so two concurrent runs — two tabs, two
 *      admins — can never claim the same group.
 *   2. Calls the existing, already-atomic and idempotent
 *      auto_merge_duplicate_group() once per claimed group, as separate
 *      round-trips — each group's result is durable the moment its own
 *      call returns, independent of every other group in the batch.
 *   3. Releases each group's claim immediately after processing
 *      (recording a failure reason + reference id on error) rather than
 *      waiting out the claim's lease.
 *
 * The caller (the admin UI) is expected to call this repeatedly — once per
 * click-triggered "run" — until `remaining` reaches 0 or a call returns
 * `attempted: 0`. Safe to call again after any interruption: every already
 * -merged group is already durably committed and will not be reprocessed.
 */
export async function runAutoMergeBatch(
  limit: number = AUTO_MERGE_BATCH_SIZE,
): Promise<AutoMergeBatchResult> {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const eligibleBefore = await getAutoMergeableDuplicateCount();

  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_auto_mergeable_duplicate_groups",
    { p_actor: admin.userId, p_limit: limit },
  );
  if (claimError) {
    const referenceId = randomUUID();
    console.error(
      `[auto-merge:${referenceId}] failed to claim a batch`,
      claimError,
    );
    throw new Error(`تعذّر حجز دفعة للدمج. رمز المرجع: ${referenceId}`);
  }

  const groupKeys = claimed ?? [];
  const { outcomes, failedGroups } = await processGroupKeys(
    supabase,
    admin.userId,
    groupKeys,
  );

  const merged = outcomes.filter((o) => o.merged).length;
  const failed = failedGroups.length;
  const skipped = outcomes.length - merged - failed;
  const remaining = await getAutoMergeableDuplicateCount();

  return {
    eligibleBefore,
    attempted: groupKeys.length,
    merged,
    skipped,
    failed,
    remaining,
    failedGroups,
    outcomes,
  };
}

/**
 * Retries exactly the given (previously failed) group keys — never a fresh
 * claim of the general backlog. Used by the admin UI's "إعادة محاولة
 * الحالات الفاشلة" action so a retry never touches groups that already
 * succeeded or are still queued in the normal batch order.
 */
export async function retryAutoMergeGroups(groupKeys: string[]): Promise<{
  outcomes: AutoMergeGroupOutcome[];
  failedGroups: AutoMergeFailure[];
}> {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  return processGroupKeys(supabase, admin.userId, groupKeys);
}

async function processGroupKeys(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  actorId: string,
  groupKeys: string[],
): Promise<{
  outcomes: AutoMergeGroupOutcome[];
  failedGroups: AutoMergeFailure[];
}> {
  const outcomes: AutoMergeGroupOutcome[] = [];
  const failedGroups: AutoMergeFailure[] = [];

  for (const groupKey of groupKeys) {
    try {
      const { data, error } = await supabase.rpc("auto_merge_duplicate_group", {
        p_actor: actorId,
        p_group_key: groupKey,
      });
      if (error) throw error;
      const row = data?.[0];
      outcomes.push({
        groupKey,
        entryId: row?.entry_id ?? null,
        merged: row?.merged ?? false,
        reason: row?.reason ?? "unknown",
      });
      await supabase.rpc("release_duplicate_group_claim", {
        p_actor: actorId,
        p_group_key: groupKey,
        p_failed: false,
      });
    } catch (err) {
      const referenceId = randomUUID();
      const message = (err as { message?: string })?.message ?? "unknown_error";
      console.error(
        `[auto-merge:${referenceId}] group ${groupKey} failed`,
        err,
      );
      outcomes.push({
        groupKey,
        entryId: null,
        merged: false,
        reason: "error",
      });
      failedGroups.push({ groupKey, reason: message, referenceId });
      try {
        await supabase.rpc("release_duplicate_group_claim", {
          p_actor: actorId,
          p_group_key: groupKey,
          p_failed: true,
          p_failure_reason: message.slice(0, 500),
        });
      } catch (releaseError) {
        console.error(
          `[auto-merge:${referenceId}] failed to release claim for ${groupKey}`,
          releaseError,
        );
      }
    }
  }

  return { outcomes, failedGroups };
}

export interface DuplicateGroupMember {
  memberType: "raw" | "canonical";
  memberId: string;
  word: string;
  /** The member's own single dialect (raw: selected_dialect_id; canonical: canonical_dialect_id — the legacy "primary"). */
  dialectId: string | null;
  /** Full dialect set: raw members have exactly one (or zero); canonical members have every dialect currently assigned via canonical_entry_dialects, unioned with the primary — see migration 0029. */
  dialectIds: string[];
  mainGroupCode: MainDialectGroupCode | null;
  localDialectLabel: string | null;
  meaning: string | null;
  /** Raw: the submitter's single MSA synonym (0 or 1 entries). Canonical: the entry's full canonical_msa_synonyms array. */
  msaSynonyms: string[];
  examples: { id: string; sentence: string }[];
  relatedWords: string[];
  conceptId: string | null;
  register: string | null;
  publicVisibility: PublicVisibility | null;
  referencePromptId: string | null;
  version: number | null;
}

export async function getDuplicateGroupMembers(
  groupKey: string,
): Promise<DuplicateGroupMember[]> {
  await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("duplicate_group_members", {
    p_group_key: groupKey,
  });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    memberType: row.member_type,
    memberId: row.member_id,
    word: row.word,
    dialectId: row.dialect_id,
    dialectIds: row.dialect_ids ?? [],
    mainGroupCode: row.main_group_code,
    localDialectLabel: row.local_dialect_label,
    meaning: row.meaning,
    msaSynonyms: row.msa_synonyms ?? [],
    examples: row.examples ?? [],
    relatedWords: row.related_words ?? [],
    conceptId: row.concept_id,
    register: row.register,
    publicVisibility: row.public_visibility,
    referencePromptId: row.reference_prompt_id,
    version: row.version,
  }));
}

export async function resolveDuplicateGroup(
  groupKey: string,
  status: "not_duplicate" | "ignored",
  memberSignature: string,
) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("resolve_duplicate_group", {
    p_actor: admin.userId,
    p_group_key: groupKey,
    p_status: status,
    p_member_signature: memberSignature,
  });
  if (error) throw error;
}

export async function reopenDuplicateGroup(groupKey: string) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("reopen_duplicate_group", {
    p_actor: admin.userId,
    p_group_key: groupKey,
  });
  if (error) throw error;
}

export interface MergeDuplicateGroupInput {
  groupKey: string;
  memberSignature: string;
  rawSubmissionIds: string[];
  targetEntryId: string | null;
  expectedVersion: number | null;
  word: string;
  /** Every main-group and local dialect the admin selected — written transactionally to canonical_entry_dialects; the first entry becomes the synchronized legacy canonical_dialect_id. */
  dialectIds: string[];
  msaSynonyms: string[];
  explanation: string;
  examples: {
    sentence: string;
    sourceRawExampleId: string | null;
    position: number;
  }[];
  removedCanonicalExampleIds?: string[];
  relatedWords: string[];
  conceptId: string | null;
  register: string | null;
  visibility: PublicVisibility;
  referencePromptId?: string | null;
}

export interface SplitDuplicateGroupWordInput {
  word: string;
  wordSearchKey: string;
  targetEntryId: string | null;
  expectedVersion: number | null;
  dialectIds: string[];
  msaSynonyms: string[];
  explanation: string;
  relatedWords: string[];
  register: string | null;
  visibility: PublicVisibility;
  referencePromptId?: string | null;
  rawSubmissionIds: string[];
  examples: {
    sentence: string;
    sourceRawExampleId: string | null;
    position: number;
  }[];
  removedCanonicalExampleIds?: string[];
}

export interface SplitDuplicateGroupInput {
  groupKey: string;
  memberSignature: string;
  /** Shared meaning link across the resulting words (e.g. جب / جيب), never a shared word_key. */
  conceptId: string | null;
  words: SplitDuplicateGroupWordInput[];
}

/**
 * "فصل إلى كلمات مستقلة": creates or preserves one canonical entry per
 * distinct word_key in `input.words`, each keeping its own dialects and
 * related_words independently, optionally linked by a shared concept_id.
 * Never merges the group's sources into a single canonical entry.
 */
export async function splitDuplicateGroupIntoWords(
  input: SplitDuplicateGroupInput,
) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();

  const keys = input.words.map((w) => toSearchKey(w.word));
  if (new Set(keys).size !== keys.length) {
    throw new Error("duplicate_word_key_in_split");
  }

  const { data, error } = await supabase.rpc("split_duplicate_group_words", {
    p_actor: admin.userId,
    p_group_key: input.groupKey,
    p_member_signature: input.memberSignature,
    p_concept_id: input.conceptId,
    p_words: input.words.map((w) => ({
      word: w.word,
      wordSearchKey: toSearchKey(w.word),
      targetEntryId: w.targetEntryId,
      expectedVersion: w.expectedVersion,
      dialectIds: w.dialectIds,
      msaSynonyms: w.msaSynonyms,
      explanation: w.explanation,
      relatedWords: w.relatedWords,
      register: w.register,
      visibility: w.visibility,
      referencePromptId: w.referencePromptId ?? null,
      rawSubmissionIds: w.rawSubmissionIds,
      examples: w.examples.map((e) => ({
        sentence: e.sentence,
        sentenceSearchKey: toSearchKey(e.sentence),
        sourceRawExampleId: e.sourceRawExampleId,
        position: e.position,
      })),
      removedCanonicalExampleIds: w.removedCanonicalExampleIds ?? [],
    })),
  });
  if (error) throw error;
  return data as string[];
}

export async function mergeDuplicateGroup(input: MergeDuplicateGroupInput) {
  const admin = await requireAdmin();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("merge_duplicate_group", {
    p_actor: admin.userId,
    p_group_key: input.groupKey,
    p_member_signature: input.memberSignature,
    p_raw_submission_ids: input.rawSubmissionIds,
    p_target_entry_id: input.targetEntryId,
    p_expected_version: input.expectedVersion,
    p_canonical_word: input.word,
    p_canonical_word_search_key: toSearchKey(input.word),
    p_dialect_ids: input.dialectIds,
    p_canonical_msa_synonyms: input.msaSynonyms,
    p_canonical_explanation: input.explanation,
    p_examples: input.examples.map((e) => ({
      sentence: e.sentence,
      sentenceSearchKey: toSearchKey(e.sentence),
      sourceRawExampleId: e.sourceRawExampleId,
      position: e.position,
    })),
    p_removed_canonical_example_ids: input.removedCanonicalExampleIds ?? [],
    p_related_words: input.relatedWords,
    p_concept_id: input.conceptId,
    p_register: input.register,
    p_visibility: input.visibility,
    p_reference_prompt_id: input.referencePromptId ?? null,
  });
  if (error) throw error;
  return data as string;
}
