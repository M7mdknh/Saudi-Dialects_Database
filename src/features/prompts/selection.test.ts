import { describe, expect, it } from "vitest";
import { selectGuidedPrompts } from "./selection";
import type { GuidedPromptRecord } from "./types";

function makePrompt(id: string, category: string): GuidedPromptRecord {
  return {
    id,
    category,
    categoryLabelAr: category,
    msaLemma: id,
    definitionAr: `تعريف ${id}`,
    scenarioAr: `سيناريو ${id}`,
    partOfSpeech: "noun",
    answerForm: "word_or_phrase",
    priority: 90,
    promptVersion: 1,
  };
}

function makePool(
  perCategory: number,
  categories: string[],
): GuidedPromptRecord[] {
  return categories.flatMap((category) =>
    Array.from({ length: perCategory }, (_, i) =>
      makePrompt(`${category}-${i}`, category),
    ),
  );
}

// Deterministic RNG for reproducible tests.
function seededRandom(seed: number) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

describe("selectGuidedPrompts", () => {
  const pool = makePool(6, [
    "food",
    "time",
    "body",
    "emotions",
    "people",
    "work",
  ]);

  it("returns exactly the requested count", () => {
    const result = selectGuidedPrompts(pool, { random: seededRandom(1) });
    expect(result).toHaveLength(6);
  });

  it("never returns duplicate prompts", () => {
    const result = selectGuidedPrompts(pool, { random: seededRandom(2) });
    expect(new Set(result.map((p) => p.id)).size).toBe(result.length);
  });

  it("only selects from the given pool", () => {
    const result = selectGuidedPrompts(pool, { random: seededRandom(3) });
    const poolIds = new Set(pool.map((p) => p.id));
    expect(result.every((p) => poolIds.has(p.id))).toBe(true);
  });

  it("avoids excluded ids when the pool is large enough", () => {
    const excludeIds = pool.slice(0, 20).map((p) => p.id);
    const result = selectGuidedPrompts(pool, {
      excludeIds,
      random: seededRandom(4),
    });
    expect(result.every((p) => !excludeIds.includes(p.id))).toBe(true);
  });

  it("balances across categories: 6 prompts from 6 categories choose one per category", () => {
    const result = selectGuidedPrompts(pool, { random: seededRandom(5) });
    const categories = new Set(result.map((p) => p.category));
    expect(categories.size).toBe(6);
  });

  it("does not always return the pool's first six rows", () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const runs = seeds.map((seed) =>
      selectGuidedPrompts(pool, { random: seededRandom(seed) }).map(
        (p) => p.id,
      ),
    );
    const allSame = runs.every((run) => run.join(",") === runs[0].join(","));
    expect(allSame).toBe(false);
  });

  it("resets safely (ignores exclusions) when the pool minus exclusions is smaller than the requested count", () => {
    const smallPool = makePool(1, ["a", "b", "c"]); // only 3 prompts total
    const excludeIds = smallPool.map((p) => p.id); // exclude all of them
    const result = selectGuidedPrompts(smallPool, {
      count: 6,
      excludeIds,
      random: seededRandom(6),
    });
    // Falls back to the full pool since excluding everything leaves nothing.
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("returns fewer than count only when the whole pool is smaller than count", () => {
    const tinyPool = makePool(1, ["a", "b"]);
    const result = selectGuidedPrompts(tinyPool, {
      count: 6,
      random: seededRandom(7),
    });
    expect(result).toHaveLength(2);
  });
});
