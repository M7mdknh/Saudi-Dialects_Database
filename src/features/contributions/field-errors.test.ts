import { describe, expect, it } from "vitest";
import { mapZodIssuesToFieldErrors } from "./field-errors";
import { submissionBatchSchema } from "./schema";

function baseWord(clientId: string, overrides: Record<string, unknown> = {}) {
  return {
    clientId,
    word: "كلمة",
    dialect: "حجازي",
    dialectId: "11111111-1111-4111-8111-111111111111",
    provisionalMainGroupCode: null,
    msaSynonym: "",
    explanation: "",
    examples: [{ sentence: "مثال صحيح" }],
    referencePromptId: null,
    referencePromptSnapshot: null,
    ...overrides,
  };
}

function basePayload(words: unknown[]) {
  return {
    idempotencyKey: "11111111-1111-1111-1111-111111111111",
    consent: true,
    consentVersion: "v1",
    words,
    turnstileToken: "token",
  };
}

describe("mapZodIssuesToFieldErrors", () => {
  it("maps the third word's blank example to that word's stable clientId, not its array index", () => {
    const words = [
      baseWord("w1"),
      baseWord("w2"),
      baseWord("w3", { examples: [{ sentence: "" }] }),
    ];
    const result = submissionBatchSchema.safeParse(basePayload(words));
    expect(result.success).toBe(false);
    if (result.success) return;
    const mapped = mapZodIssuesToFieldErrors(result.error, words);
    expect(mapped.w3?.["example-0"]).toBe("أدخل مثالاً أو احذف هذا الحقل");
    expect(mapped.w1).toBeUndefined();
    expect(mapped.w2).toBeUndefined();
  });

  it("maps the fourth word's error to word 4's clientId, never word 3's", () => {
    const words = [
      baseWord("w1"),
      baseWord("w2"),
      baseWord("w3"),
      baseWord("w4", { word: "" }),
    ];
    const result = submissionBatchSchema.safeParse(basePayload(words));
    expect(result.success).toBe(false);
    if (result.success) return;
    const mapped = mapZodIssuesToFieldErrors(result.error, words);
    expect(mapped.w4?.word).toBe("الكلمة مطلوبة");
    expect(mapped.w3).toBeUndefined();
  });

  it("stays correctly attached after the caller reorders the same words array", () => {
    // Simulates a reorder: word3 (invalid) moves to the front.
    const original = [
      baseWord("w1"),
      baseWord("w2"),
      baseWord("w3", { examples: [{ sentence: "" }] }),
    ];
    const failing = submissionBatchSchema.safeParse(basePayload(original));
    expect(failing.success).toBe(false);
    if (failing.success) return;

    const reordered = [original[2], original[0], original[1]];
    // Re-validating the reordered array still finds the error under w3 only
    // — the whole point of keying by clientId instead of position.
    const result = submissionBatchSchema.safeParse(basePayload(reordered));
    expect(result.success).toBe(false);
    if (result.success) return;
    const mapped = mapZodIssuesToFieldErrors(result.error, reordered);
    expect(mapped.w3?.["example-0"]).toBe("أدخل مثالاً أو احذف هذا الحقل");
    expect(mapped.w1).toBeUndefined();
    expect(mapped.w2).toBeUndefined();
  });

  it("falls back to an index-based key when a word entry has no clientId (malformed request)", () => {
    const words = [{ word: "" }];
    const result = submissionBatchSchema.safeParse(basePayload(words));
    expect(result.success).toBe(false);
    if (result.success) return;
    const mapped = mapZodIssuesToFieldErrors(result.error, words);
    expect(mapped["index-0"]).toBeDefined();
  });
});
