import { toSearchKey } from "@/lib/text/normalize-arabic";
import type { DuplicateGroupMember } from "./actions";

/**
 * Default bucketing for "فصل إلى كلمات مستقلة": groups a duplicate group's
 * members by their own word_key (never by shared meaning or spelling
 * similarity), so distinct spellings such as "جب" and "جيب" start out as
 * separate buckets even though a fuzzy/possible-match group surfaced them
 * together. Each bucket keeps its own dialect assignment, meaning, MSA
 * synonyms, and examples independently — nothing here merges bucket
 * content across word keys.
 */
export interface SplitBucket {
  wordKey: string;
  word: string;
  targetEntryId: string | null;
  expectedVersion: number | null;
  dialectIds: string[];
  msaSynonyms: string[];
  explanation: string;
  relatedWords: string[];
  register: string | null;
  visibility: "public" | "private";
  referencePromptId: string | null;
  rawSubmissionIds: string[];
  examples: { id: string; sentence: string; sourceType: "raw" | "canonical" }[];
}

export function buildDefaultSplitBuckets(
  members: DuplicateGroupMember[],
): SplitBucket[] {
  const buckets = new Map<string, SplitBucket>();

  for (const m of members) {
    const wordKey = toSearchKey(m.word);
    const existing = buckets.get(wordKey);
    if (existing) {
      // Same word_key: same bucket, but each member's own dialects/examples
      // are still added rather than one overwriting the other.
      existing.dialectIds = [
        ...new Set([...existing.dialectIds, ...m.dialectIds]),
      ];
      existing.msaSynonyms = [
        ...new Set([...existing.msaSynonyms, ...m.msaSynonyms]),
      ];
      existing.relatedWords = [
        ...new Set([...existing.relatedWords, ...m.relatedWords]),
      ];
      if (m.memberType === "raw") existing.rawSubmissionIds.push(m.memberId);
      if (m.memberType === "canonical") {
        existing.targetEntryId = m.memberId;
        existing.expectedVersion = m.version;
      }
      for (const e of m.examples) {
        existing.examples.push({ ...e, sourceType: m.memberType });
      }
      continue;
    }

    buckets.set(wordKey, {
      wordKey,
      word: m.word,
      targetEntryId: m.memberType === "canonical" ? m.memberId : null,
      expectedVersion: m.memberType === "canonical" ? m.version : null,
      dialectIds: [...m.dialectIds],
      msaSynonyms: [...m.msaSynonyms],
      explanation: m.meaning ?? "",
      relatedWords: [...m.relatedWords],
      register: m.register,
      visibility: m.publicVisibility ?? "public",
      referencePromptId: m.referencePromptId,
      rawSubmissionIds: m.memberType === "raw" ? [m.memberId] : [],
      examples: m.examples.map((e) => ({ ...e, sourceType: m.memberType })),
    });
  }

  return [...buckets.values()];
}
