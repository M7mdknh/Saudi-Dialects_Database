"use server";

import { createHash } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { toSearchKey } from "@/lib/text/normalize-arabic";
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

export interface DuplicateGroupMember {
  memberType: "raw" | "canonical";
  memberId: string;
  word: string;
  mainGroupCode: MainDialectGroupCode | null;
  localDialectLabel: string | null;
  meaning: string | null;
  msaSynonym: string | null;
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
    mainGroupCode: row.main_group_code,
    localDialectLabel: row.local_dialect_label,
    meaning: row.meaning,
    msaSynonym: row.msa_synonym,
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
  dialectId: string;
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
    p_canonical_dialect_id: input.dialectId,
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
