import { describe, expect, it } from "vitest";
import { buildDefaultSplitBuckets } from "./split-groups";
import type { DuplicateGroupMember } from "./actions";

function member(
  overrides: Partial<DuplicateGroupMember>,
): DuplicateGroupMember {
  return {
    memberType: "raw",
    memberId: "m1",
    word: "جب",
    dialectId: null,
    dialectIds: [],
    mainGroupCode: null,
    localDialectLabel: null,
    meaning: null,
    msaSynonyms: [],
    examples: [],
    relatedWords: [],
    conceptId: null,
    register: null,
    publicVisibility: null,
    referencePromptId: null,
    version: null,
    ...overrides,
  };
}

describe("buildDefaultSplitBuckets — جب vs جيب regression", () => {
  const najdiDialectId = "d-najdi";
  const hijaziDialectId = "d-hijazi";

  const jubb = member({
    memberId: "raw-jubb",
    word: "جب",
    dialectIds: [najdiDialectId],
    mainGroupCode: "najdi",
    meaning: "يعني نفس معنى جيب",
  });
  const jeeb = member({
    memberId: "raw-jeeb",
    word: "جيب",
    dialectIds: [hijaziDialectId],
    mainGroupCode: "hijazi",
    meaning: "يعني نفس معنى جب",
  });

  const buckets = buildDefaultSplitBuckets([jubb, jeeb]);

  it("never collapses two different word forms into one bucket even with identical meaning", () => {
    expect(buckets).toHaveLength(2);
  });

  it("keeps each word's own word_key distinct", () => {
    const keys = buckets.map((b) => b.wordKey);
    expect(new Set(keys).size).toBe(2);
    expect(keys).toContain("جب");
    expect(keys).toContain("جيب");
  });

  it("preserves each word's dialect assignment independently", () => {
    const jubbBucket = buckets.find((b) => b.wordKey === "جب")!;
    const jeebBucket = buckets.find((b) => b.wordKey === "جيب")!;
    expect(jubbBucket.dialectIds).toEqual([najdiDialectId]);
    expect(jeebBucket.dialectIds).toEqual([hijaziDialectId]);
    // Neither word's dialect assignment leaks into the other's.
    expect(jubbBucket.dialectIds).not.toContain(hijaziDialectId);
    expect(jeebBucket.dialectIds).not.toContain(najdiDialectId);
  });

  it("does not place one spelling inside the other's related words merely because they share a meaning", () => {
    for (const bucket of buckets) {
      expect(bucket.relatedWords).not.toContain("جب");
      expect(bucket.relatedWords).not.toContain("جيب");
    }
  });

  it("routes each raw submission id to its own bucket, not both", () => {
    const jubbBucket = buckets.find((b) => b.wordKey === "جب")!;
    const jeebBucket = buckets.find((b) => b.wordKey === "جيب")!;
    expect(jubbBucket.rawSubmissionIds).toEqual(["raw-jubb"]);
    expect(jeebBucket.rawSubmissionIds).toEqual(["raw-jeeb"]);
  });

  it("still groups two members that share the exact same word_key into one bucket", () => {
    const sameSpelling = buildDefaultSplitBuckets([
      member({ memberId: "raw-1", word: "جب", dialectIds: [najdiDialectId] }),
      member({ memberId: "raw-2", word: "جب", dialectIds: [hijaziDialectId] }),
    ]);
    expect(sameSpelling).toHaveLength(1);
    expect(sameSpelling[0].dialectIds.sort()).toEqual(
      [najdiDialectId, hijaziDialectId].sort(),
    );
    expect(sameSpelling[0].rawSubmissionIds.sort()).toEqual(["raw-1", "raw-2"]);
  });
});
