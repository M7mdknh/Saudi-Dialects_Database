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
    dialectId: "11111111-1111-4111-8111-111111111111" as string | null,
    provisionalMainGroupCode: null as string | null,
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

  it("allows an empty formal-Arabic synonym (optional for ordinary submissions)", () => {
    expect(wordCardSchema.safeParse(makeWord({ msaSynonym: "" })).success).toBe(
      true,
    );
  });

  it("allows an omitted formal-Arabic synonym", () => {
    const word = makeWord();
    delete (word as { msaSynonym?: string }).msaSynonym;
    expect(wordCardSchema.safeParse(word).success).toBe(true);
  });

  it("still accepts a provided formal-Arabic synonym (guided contributions)", () => {
    expect(
      wordCardSchema.safeParse(makeWord({ msaSynonym: "بلا هدف" })).success,
    ).toBe(true);
  });

  it("rejects a formal-Arabic synonym over the length limit", () => {
    const result = wordCardSchema.safeParse(
      makeWord({ msaSynonym: "أ".repeat(201) }),
    );
    expect(result.success).toBe(false);
  });

  it("requires a provisional main group when no dialect was matched (a custom local label)", () => {
    const result = wordCardSchema.safeParse(
      makeWord({ dialectId: null, provisionalMainGroupCode: null }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path[0] === "provisionalMainGroupCode",
      );
      expect(issue).toBeDefined();
    }
  });

  it("accepts a custom dialect once a provisional main group is provided", () => {
    const result = wordCardSchema.safeParse(
      makeWord({ dialectId: null, provisionalMainGroupCode: "najdi" }),
    );
    expect(result.success).toBe(true);
  });

  it("does not require a provisional main group when an existing dialect was matched", () => {
    const result = wordCardSchema.safeParse(
      makeWord({
        dialectId: "11111111-1111-4111-8111-111111111111",
        provisionalMainGroupCode: null,
      }),
    );
    expect(result.success).toBe(true);
  });

  describe("example normalization", () => {
    it("silently drops a blank optional extra example, keeping the valid one", () => {
      const result = wordCardSchema.safeParse(
        makeWord({ examples: [{ sentence: "جملة صحيحة" }, { sentence: "" }] }),
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.examples).toEqual([{ sentence: "جملة صحيحة" }]);
      }
    });

    it("silently drops a blank example that comes before the valid one", () => {
      const result = wordCardSchema.safeParse(
        makeWord({ examples: [{ sentence: "" }, { sentence: "جملة صحيحة" }] }),
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.examples).toEqual([{ sentence: "جملة صحيحة" }]);
      }
    });

    it("does not invalidate a word that already has one valid example plus a blank row", () => {
      const result = wordCardSchema.safeParse(
        makeWord({
          examples: [
            { sentence: "جملة صحيحة" },
            { sentence: "" },
            { sentence: "" },
          ],
        }),
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.examples).toEqual([{ sentence: "جملة صحيحة" }]);
      }
    });

    it("fails, attached to the first example field, when every example is blank", () => {
      const result = wordCardSchema.safeParse(
        makeWord({ examples: [{ sentence: "" }, { sentence: "" }] }),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find(
          (i) => i.path.join(".") === "examples.0.sentence",
        );
        expect(issue?.message).toBe("أدخل مثالاً أو احذف هذا الحقل");
      }
    });

    it("preserves multiple valid examples without combining or removing them", () => {
      const result = wordCardSchema.safeParse(
        makeWord({
          examples: [{ sentence: "جملة أولى" }, { sentence: "جملة ثانية" }],
        }),
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.examples).toEqual([
          { sentence: "جملة أولى" },
          { sentence: "جملة ثانية" },
        ]);
      }
    });

    it("reports an over-length second example at its own index, not the first", () => {
      const result = wordCardSchema.safeParse(
        makeWord({
          examples: [{ sentence: "قصيرة" }, { sentence: "أ".repeat(501) }],
        }),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find(
          (i) => i.path.join(".") === "examples.1.sentence",
        );
        expect(issue).toBeDefined();
        const wrongIssue = result.error.issues.find(
          (i) => i.path.join(".") === "examples.0.sentence",
        );
        expect(wrongIssue).toBeUndefined();
      }
    });

    it("trims surrounding whitespace without altering the reviewed Arabic text", () => {
      const result = wordCardSchema.safeParse(
        makeWord({ examples: [{ sentence: "  جملة مع مسافات  " }] }),
      );
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.examples).toEqual([{ sentence: "جملة مع مسافات" }]);
      }
    });
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
