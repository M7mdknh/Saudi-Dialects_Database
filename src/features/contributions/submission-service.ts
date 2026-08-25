import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toSearchKey } from "@/lib/text/normalize-arabic";
import type { SubmissionBatchInput } from "./schema";

export interface LeaderboardUpdate {
  mainGroupCode: string;
  submissionCount: number;
}

export interface CreateBatchResult {
  batchId: string;
  created: boolean;
  /** Number of word entries actually stored by this call — 0 for an idempotent replay. */
  acceptedEntryCount: number;
  /** Authoritative, freshly-read submission_count for every main group this batch touched (empty on a replay or when every word was unclassified). */
  leaderboardUpdates: LeaderboardUpdate[];
}

/** Derives search keys and performs the atomic batch insert via submit_batch(). */
export async function createSubmissionBatch(
  payload: Pick<
    SubmissionBatchInput,
    "idempotencyKey" | "consentVersion" | "words"
  >,
  abuseHash: string | null,
  abuseHashExpiresAt: string | null,
): Promise<CreateBatchResult> {
  const admin = createSupabaseAdminClient();

  const words = payload.words.map((word) => ({
    word: word.word,
    dialect: word.dialect,
    dialectId: word.dialectId ?? null,
    provisionalMainGroupCode: word.provisionalMainGroupCode ?? null,
    msaSynonym: word.msaSynonym,
    explanation: word.explanation ?? "",
    wordSearchKey: toSearchKey(word.word),
    dialectSearchKey: toSearchKey(word.dialect),
    referencePromptId: word.referencePromptId ?? null,
    referencePromptSnapshot: word.referencePromptSnapshot ?? null,
    examples: word.examples.map((example, index) => ({
      sentence: example.sentence,
      sentenceSearchKey: toSearchKey(example.sentence),
      position: index,
    })),
  }));

  const { data, error } = await admin.rpc("submit_batch", {
    p_idempotency_key: payload.idempotencyKey,
    p_consent_version: payload.consentVersion,
    p_words: words,
    p_abuse_hash: abuseHash,
    p_abuse_hash_expires_at: abuseHashExpiresAt,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    batchId: row.batch_id,
    created: row.created,
    acceptedEntryCount: row.created ? payload.words.length : 0,
    leaderboardUpdates: (row.affected_groups ?? []).map((g) => ({
      mainGroupCode: g.main_group_code,
      submissionCount: g.submission_count,
    })),
  };
}
