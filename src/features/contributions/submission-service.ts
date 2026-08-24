import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toSearchKey } from "@/lib/text/normalize-arabic";
import type { SubmissionBatchInput } from "./schema";

export interface CreateBatchResult {
  batchId: string;
  created: boolean;
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
    msaSynonym: word.msaSynonym,
    explanation: word.explanation ?? "",
    wordSearchKey: toSearchKey(word.word),
    dialectSearchKey: toSearchKey(word.dialect),
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
  return { batchId: row.batch_id, created: row.created };
}
