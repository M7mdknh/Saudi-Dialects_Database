import type { GuidedPromptRecord } from "./types";

export const GUIDED_PROMPT_DISPLAY_COUNT = 6;

export interface SelectGuidedPromptsOptions {
  excludeIds?: string[];
  count?: number;
  random?: () => number;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Selects a rotating, category-balanced set of active guided prompts.
 *
 * - Only ever chooses from `pool` entries (callers pass active prompts only).
 * - Avoids `excludeIds` (recently shown / answered this session) when the
 *   remaining pool is large enough; otherwise resets and ignores the
 *   exclusion list rather than returning fewer than `count` prompts.
 * - Never deterministically returns the same leading rows: order is
 *   shuffled with an injectable RNG (defaults to Math.random) so behavior
 *   is reproducible in tests.
 * - Maximizes category diversity first, then fills any remaining slots.
 */
export function selectGuidedPrompts(
  pool: GuidedPromptRecord[],
  options: SelectGuidedPromptsOptions = {},
): GuidedPromptRecord[] {
  const count = options.count ?? GUIDED_PROMPT_DISPLAY_COUNT;
  const random = options.random ?? Math.random;
  const excludeIds = new Set(options.excludeIds ?? []);

  let candidates = pool.filter((p) => !excludeIds.has(p.id));
  if (candidates.length < count) {
    // Reset: the exclusion history has exhausted the pool. Ignore it rather
    // than showing fewer than `count` prompts.
    candidates = pool;
  }

  const shuffled = shuffle(candidates, random);

  const balanced: GuidedPromptRecord[] = [];
  const usedCategories = new Set<string>();
  for (const prompt of shuffled) {
    if (balanced.length >= count) break;
    if (!usedCategories.has(prompt.category)) {
      balanced.push(prompt);
      usedCategories.add(prompt.category);
    }
  }

  if (balanced.length < count) {
    const chosenIds = new Set(balanced.map((p) => p.id));
    for (const prompt of shuffled) {
      if (balanced.length >= count) break;
      if (!chosenIds.has(prompt.id)) {
        balanced.push(prompt);
        chosenIds.add(prompt.id);
      }
    }
  }

  return balanced.slice(0, count);
}
