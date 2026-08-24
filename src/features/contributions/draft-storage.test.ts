import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDraft,
  getOrCreateIdempotencyKey,
  loadDraft,
  rotateIdempotencyKey,
  saveDraft,
} from "./draft-storage";
import { emptyWordCard } from "./batch-reducer";

beforeEach(() => {
  window.localStorage.clear();
});

describe("draft persistence", () => {
  it("returns null when no draft was saved", () => {
    expect(loadDraft()).toBeNull();
  });

  it("round-trips a saved draft", () => {
    const words = [emptyWordCard()];
    saveDraft({ words, consent: true });
    const loaded = loadDraft();
    expect(loaded?.words).toHaveLength(1);
    expect(loaded?.consent).toBe(true);
  });

  it("clears the draft", () => {
    saveDraft({ words: [emptyWordCard()], consent: false });
    clearDraft();
    expect(loadDraft()).toBeNull();
  });
});

describe("idempotency key", () => {
  it("creates and persists a key on first call", () => {
    const key = getOrCreateIdempotencyKey();
    expect(getOrCreateIdempotencyKey()).toBe(key);
  });

  it("rotates to a new key after being cleared", () => {
    const first = getOrCreateIdempotencyKey();
    rotateIdempotencyKey();
    const second = getOrCreateIdempotencyKey();
    expect(second).not.toBe(first);
  });
});
