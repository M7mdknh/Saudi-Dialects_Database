import { describe, expect, it } from "vitest";
import {
  dedupeExamplesByKey,
  distinctNormalizedMeanings,
  evaluateAutoMergeEligibility,
  hasConceptConflict,
  normalizeMeaningText,
  pickAutoMergePrimaryDialect,
  resolveAutoMergeMeaning,
  unionPreservingOrder,
} from "./auto-merge-rules";

describe("normalizeMeaningText", () => {
  it("trims and collapses repeated whitespace", () => {
    expect(normalizeMeaningText("  يعني   تعب  ")).toBe("يعني تعب");
  });
  it("treats blank and null as absent", () => {
    expect(normalizeMeaningText("   ")).toBeNull();
    expect(normalizeMeaningText(null)).toBeNull();
    expect(normalizeMeaningText(undefined)).toBeNull();
  });
  it("does not assume differently worded definitions are the same", () => {
    expect(normalizeMeaningText("متعب جدا")).not.toBe(
      normalizeMeaningText("مرهق تماما"),
    );
  });
});

describe("distinctNormalizedMeanings", () => {
  it("dedupes only exact normalized matches", () => {
    expect(
      distinctNormalizedMeanings(["  تعب  ", "تعب", null, "", "  تعب"]),
    ).toEqual(["تعب"]);
  });
  it("keeps genuinely different meanings distinct", () => {
    expect(distinctNormalizedMeanings(["تعب", "فرح"])).toHaveLength(2);
  });
});

describe("resolveAutoMergeMeaning — meaning decision rule", () => {
  it("zero distinct meanings: eligible, meaning is null", () => {
    const result = resolveAutoMergeMeaning([
      { text: null, order: 0 },
      { text: "  ", order: 1 },
    ]);
    expect(result).toEqual({ eligible: true, meaning: null });
  });

  it("exactly one distinct meaning: eligible, meaning preserved exactly", () => {
    const result = resolveAutoMergeMeaning([{ text: "تعب شديد", order: 0 }]);
    expect(result).toEqual({ eligible: true, meaning: "تعب شديد" });
  });

  it("multiple records with the identical meaning: eligible, single meaning kept", () => {
    const result = resolveAutoMergeMeaning([
      { text: "تعب شديد", order: 0 },
      { text: "تعب شديد", order: 1 },
      { text: "  تعب شديد  ", order: 2 },
    ]);
    expect(result.eligible).toBe(true);
    expect(normalizeMeaningText(result.meaning)).toBe("تعب شديد");
  });

  it("picks the earliest source's own text deterministically, independent of input order", () => {
    const sources = [
      { text: "تعب شديد", order: 5 },
      { text: "  تعب شديد  ", order: 1 },
    ];
    const a = resolveAutoMergeMeaning(sources);
    const b = resolveAutoMergeMeaning([...sources].reverse());
    expect(a).toEqual(b);
    expect(a.meaning).toBe("تعب شديد");
  });

  it("two different meanings: not eligible, no automatic merge", () => {
    const result = resolveAutoMergeMeaning([
      { text: "تعب شديد", order: 0 },
      { text: "غضب شديد", order: 1 },
    ]);
    expect(result).toEqual({ eligible: false, meaning: null });
  });
});

describe("hasConceptConflict", () => {
  it("no conflict when concept ids are missing or identical", () => {
    expect(hasConceptConflict([null, undefined])).toBe(false);
    expect(hasConceptConflict(["pocket", "pocket"])).toBe(false);
  });
  it("blocks automatic merging on two different non-null concept ids, even with no meanings", () => {
    expect(hasConceptConflict(["pocket", "wallet"])).toBe(true);
  });
});

describe("evaluateAutoMergeEligibility", () => {
  const base = {
    candidateType: "exact" as const,
    meanings: [] as (string | null)[],
    conceptIds: [] as (string | null)[],
    canonicalCount: 0,
    resolutionStatus: "unresolved" as const,
  };

  it("same word, same dialect, no meanings -> eligible", () => {
    expect(evaluateAutoMergeEligibility(base)).toEqual({ eligible: true });
  });

  it("same word, one available meaning -> eligible", () => {
    expect(
      evaluateAutoMergeEligibility({ ...base, meanings: ["تعب"] }),
    ).toEqual({ eligible: true });
  });

  it("two distinct meanings -> not eligible, routed as meaning conflict", () => {
    expect(
      evaluateAutoMergeEligibility({
        ...base,
        meanings: ["تعب", "فرح"],
      }),
    ).toEqual({ eligible: false, reason: "meaning_conflict" });
  });

  it("never uses fuzzy or conflict candidate types for automatic merging", () => {
    expect(
      evaluateAutoMergeEligibility({ ...base, candidateType: "fuzzy" }),
    ).toEqual({ eligible: false, reason: "not_exact" });
    expect(
      evaluateAutoMergeEligibility({ ...base, candidateType: "conflict" }),
    ).toEqual({ eligible: false, reason: "not_exact" });
  });

  it("different concept ids block automatic merging even without a meaning conflict", () => {
    expect(
      evaluateAutoMergeEligibility({
        ...base,
        conceptIds: ["pocket", "wallet"],
      }),
    ).toEqual({ eligible: false, reason: "concept_conflict" });
  });

  it("more than one existing canonical entry is not auto-mergeable", () => {
    expect(
      evaluateAutoMergeEligibility({ ...base, canonicalCount: 2 }),
    ).toEqual({ eligible: false, reason: "multiple_canonical_entries" });
  });

  it("a group an admin already resolved is never reprocessed automatically", () => {
    expect(
      evaluateAutoMergeEligibility({
        ...base,
        resolutionStatus: "not_duplicate",
      }),
    ).toEqual({ eligible: false, reason: "already_resolved" });
    expect(
      evaluateAutoMergeEligibility({ ...base, resolutionStatus: "ignored" }),
    ).toEqual({ eligible: false, reason: "already_resolved" });
  });
});

describe("pickAutoMergePrimaryDialect — legacy canonical_dialect_id sync", () => {
  it("preserves the existing canonical primary dialect when present", () => {
    expect(
      pickAutoMergePrimaryDialect({
        existingPrimaryDialectId: "d-hijazi",
        votes: [{ dialectId: "d-najdi", mainGroupCode: "najdi" }],
      }),
    ).toBe("d-hijazi");
  });

  it("otherwise uses the dialect represented by the most sources", () => {
    expect(
      pickAutoMergePrimaryDialect({
        existingPrimaryDialectId: null,
        votes: [
          { dialectId: "d-najdi", mainGroupCode: "najdi" },
          { dialectId: "d-najdi", mainGroupCode: "najdi" },
          { dialectId: "d-hijazi", mainGroupCode: "hijazi" },
        ],
      }),
    ).toBe("d-najdi");
  });

  it("resolves ties using the stable project dialect order", () => {
    expect(
      pickAutoMergePrimaryDialect({
        existingPrimaryDialectId: null,
        votes: [
          { dialectId: "d-southern", mainGroupCode: "southern" },
          { dialectId: "d-hijazi", mainGroupCode: "hijazi" },
        ],
      }),
    ).toBe("d-hijazi");
  });
});

describe("unionPreservingOrder", () => {
  it("unions and deduplicates, never dropping an existing value", () => {
    expect(unionPreservingOrder(["a", "b"], ["b", "c"])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
  it("existing canonical dialects/synonyms are preserved even with no additions", () => {
    expect(unionPreservingOrder(["a"], [])).toEqual(["a"]);
  });
});

describe("dedupeExamplesByKey — examples merge result", () => {
  it("retains every unique example and removes only exact duplicates after trimming", () => {
    const result = dedupeExamplesByKey([
      { sentence: "  الجملة الأولى  ", sentenceKey: "k1", order: 0 },
      { sentence: "الجملة الأولى", sentenceKey: "k1", order: 1 },
      { sentence: "الجملة الثانية", sentenceKey: "k2", order: 2 },
      { sentence: "   ", sentenceKey: "k3", order: 3 },
    ]);
    expect(result).toEqual([
      { sentence: "الجملة الأولى", sentenceKey: "k1", order: 0 },
      { sentence: "الجملة الثانية", sentenceKey: "k2", order: 2 },
    ]);
  });

  it("preserves deterministic ordering independent of input order", () => {
    const a = dedupeExamplesByKey([
      { sentence: "ب", sentenceKey: "kb", order: 1 },
      { sentence: "أ", sentenceKey: "ka", order: 0 },
    ]);
    const b = dedupeExamplesByKey([
      { sentence: "أ", sentenceKey: "ka", order: 0 },
      { sentence: "ب", sentenceKey: "kb", order: 1 },
    ]);
    expect(a).toEqual(b);
    expect(a.map((e) => e.sentence)).toEqual(["أ", "ب"]);
  });
});
