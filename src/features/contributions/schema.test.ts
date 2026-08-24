import { describe, expect, it } from "vitest";
import { submissionBatchSchema, wordCardSchema } from "./schema";
import { MAX_WORD_CARDS } from "./constants";

function makeWord(overrides: Partial<ReturnType<typeof baseWord>> = {}) {
  return { ...baseWord(), ...overrides };
}

function baseWord() {
  return {
    clientId: "word-1",
    word: "سبهللة",
    dialect: "حجازي",
    msaSynonym: "بلا هدف",
    explanation: "",
    examples: [{ sentence: "راح يمشي سبهللة" }],
  };
}

describe("wordCardSchema", () => {
  it("accepts a minimal valid card", () => {
    expect(wordCardSchema.safeParse(baseWord()).success).toBe(true);
  });

  it("rejects a missing word", () => {
    const result = wordCardSchema.safeParse(makeWord({ word: "" }));
    expect(result.success).toBe(false);
  });

  it("rejects a card with zero examples", () => {
    const result = wordCardSchema.safeParse(makeWord({ examples: [] }));
    expect(result.success).toBe(false);
  });

  it("allows an empty optional explanation", () => {
    expect(
      wordCardSchema.safeParse(makeWord({ explanation: "" })).success,
    ).toBe(true);
  });
});

describe("submissionBatchSchema", () => {
  const base = {
    idempotencyKey: "6f6b1a3e-3f2b-4b0e-9c1a-9d4d6f6d7a10",
    consent: true as const,
    consentVersion: "v1",
    words: [baseWord()],
  };

  it("accepts a valid single-word batch", () => {
    expect(submissionBatchSchema.safeParse(base).success).toBe(true);
  });

  it("rejects when consent is false", () => {
    const result = submissionBatchSchema.safeParse({ ...base, consent: false });
    expect(result.success).toBe(false);
  });

  it("rejects more than the maximum word cards", () => {
    const words = Array.from({ length: MAX_WORD_CARDS + 1 }, (_, i) =>
      makeWord({ clientId: `word-${i}` }),
    );
    const result = submissionBatchSchema.safeParse({ ...base, words });
    expect(result.success).toBe(false);
  });

  it("rejects an empty batch", () => {
    const result = submissionBatchSchema.safeParse({ ...base, words: [] });
    expect(result.success).toBe(false);
  });

  it("identifies which word index failed validation", () => {
    const words = [baseWord(), makeWord({ clientId: "word-2", word: "" })];
    const result = submissionBatchSchema.safeParse({ ...base, words });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path[0] === "words" && i.path[1] === 1,
      );
      expect(issue).toBeDefined();
    }
  });
});
