/**
 * Pure decision logic for automatic exact-word_key duplicate merging.
 * Mirrors the SQL implementation in
 * supabase/migrations/0031_duplicate_group_auto_merge.sql exactly — any
 * change here must be ported there too (and vice versa). Kept in TypeScript
 * so the decision rules have fast, DB-independent regression coverage; the
 * SQL migration is the actual source of truth executed against the
 * database.
 *
 * Core restriction: automatic merging only ever applies within one
 * word_key. It is never used to decide *whether* two different word_key
 * groups (e.g. "جب" and "جيب") should merge — that decision is out of
 * scope by construction, since these functions only ever look at a single
 * exact-match group's members.
 */

import { MAIN_GROUP_ORDER } from "./dialect-selection";
import type { MainDialectGroupCode } from "@/lib/supabase/types";

/**
 * Bounded batch size for one automatic-merge round-trip. Deliberately kept
 * far below any platform timeout — a production incident (791 eligible
 * groups) confirmed that processing an unbounded backlog inside a single
 * request/transaction (the old bulk_auto_merge_duplicate_groups RPC)
 * reliably exceeds statement/connection/function timeouts before it can
 * finish, and — since it was one open transaction — commits nothing at
 * all when that happens. See migration 0032. Kept out of actions.ts: a
 * "use server" file may only export async functions, never a plain const.
 */
export const AUTO_MERGE_BATCH_SIZE = 25;

/** Trim, collapse repeated whitespace, and treat a blank result as absent. */
export function normalizeMeaningText(
  text: string | null | undefined,
): string | null {
  if (text == null) return null;
  const collapsed = text.trim().replace(/\s+/g, " ");
  return collapsed.length > 0 ? collapsed : null;
}

/** Distinct normalized meanings, deduplicated on exact normalized text only — never fuzzy. */
export function distinctNormalizedMeanings(
  meanings: (string | null | undefined)[],
): string[] {
  const seen = new Set<string>();
  for (const m of meanings) {
    const normalized = normalizeMeaningText(m);
    if (normalized) seen.add(normalized);
  }
  return [...seen];
}

export interface MeaningSource {
  text: string | null | undefined;
  /** Stable ordering key (e.g. created_at + id) — earliest wins when picking a representative source. */
  order: number;
}

export interface MeaningResolution {
  /** true only when 0 or 1 distinct normalized meaning exists across all sources. */
  eligible: boolean;
  /** null when there are zero meanings; the earliest source's original (trimmed-only) text when there is exactly one. */
  meaning: string | null;
}

/**
 * Meaning decision rule:
 *   0 distinct meanings -> merge automatically, meaning = null.
 *   1 distinct meaning  -> merge automatically, preserve it exactly.
 *   2+ distinct meanings -> not eligible (manual review, "تعارض في المعنى").
 *
 * The returned `meaning` is the earliest source's own text (trimmed only,
 * never whitespace-collapsed) — "preserve that meaning exactly" — chosen
 * deterministically by `order` so the result never depends on array input
 * order.
 */
export function resolveAutoMergeMeaning(
  sources: MeaningSource[],
): MeaningResolution {
  const distinct = distinctNormalizedMeanings(sources.map((s) => s.text));
  if (distinct.length === 0) return { eligible: true, meaning: null };
  if (distinct.length >= 2) return { eligible: false, meaning: null };

  const sorted = [...sources].sort((a, b) => a.order - b.order);
  for (const s of sorted) {
    const normalized = normalizeMeaningText(s.text);
    if (normalized === distinct[0]) {
      return { eligible: true, meaning: s.text!.trim() };
    }
  }
  // Unreachable: distinct[0] was derived from these same sources.
  return { eligible: true, meaning: distinct[0] };
}

/**
 * Different non-null concept_id values block automatic merging even when
 * meanings are missing or agree.
 */
export function hasConceptConflict(
  conceptIds: (string | null | undefined)[],
): boolean {
  const distinct = new Set(
    conceptIds
      .map((c) => (c == null ? null : c.trim()))
      .filter((c): c is string => !!c),
  );
  return distinct.size >= 2;
}

export interface AutoMergeEligibilityInput {
  /** Only 'exact' (same word_key) groups are ever eligible — never 'fuzzy' or 'conflict'. */
  candidateType: "exact" | "conflict" | "fuzzy";
  meanings: (string | null | undefined)[];
  conceptIds: (string | null | undefined)[];
  /** Number of already-approved canonical entries sharing this word_key in the group. */
  canonicalCount: number;
  /** The group's current admin-resolution status; only 'unresolved' groups are auto-mergeable. */
  resolutionStatus:
    "unresolved" | "not_duplicate" | "ignored" | "merged" | "split";
}

export interface AutoMergeEligibility {
  eligible: boolean;
  /** Present when `eligible` is false, for surfacing why a group was skipped. */
  reason?:
    | "not_exact"
    | "meaning_conflict"
    | "concept_conflict"
    | "multiple_canonical_entries"
    | "already_resolved";
}

/**
 * Whole-group eligibility for automatic merging. Never uses fuzzy spelling
 * or semantic similarity — `candidateType` must already be the exact
 * word_key match classification computed upstream.
 */
export function evaluateAutoMergeEligibility(
  input: AutoMergeEligibilityInput,
): AutoMergeEligibility {
  if (input.resolutionStatus !== "unresolved") {
    return { eligible: false, reason: "already_resolved" };
  }
  if (input.candidateType !== "exact") {
    return { eligible: false, reason: "not_exact" };
  }
  if (input.canonicalCount > 1) {
    return { eligible: false, reason: "multiple_canonical_entries" };
  }
  if (distinctNormalizedMeanings(input.meanings).length >= 2) {
    return { eligible: false, reason: "meaning_conflict" };
  }
  if (hasConceptConflict(input.conceptIds)) {
    return { eligible: false, reason: "concept_conflict" };
  }
  return { eligible: true };
}

/** Union two string lists, deduplicated, preserving first-occurrence order (existing values first). */
export function unionPreservingOrder(
  existing: string[],
  additions: string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of [...existing, ...additions]) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export interface DialectVote {
  dialectId: string;
  mainGroupCode: MainDialectGroupCode | null;
}

/**
 * Legacy `canonical_dialect_id` sync:
 *   1. Preserve the existing canonical primary dialect when present.
 *   2. Otherwise use the dialect represented by the most sources.
 *   3. Resolve ties using the stable project dialect order
 *      (hijazi, najdi, eastern, northern, southern), then by dialect id.
 */
export function pickAutoMergePrimaryDialect(params: {
  existingPrimaryDialectId: string | null;
  votes: DialectVote[];
}): string | null {
  if (params.existingPrimaryDialectId) return params.existingPrimaryDialectId;
  if (params.votes.length === 0) return null;

  const counts = new Map<
    string,
    { count: number; code: MainDialectGroupCode | null }
  >();
  for (const v of params.votes) {
    const entry = counts.get(v.dialectId) ?? {
      count: 0,
      code: v.mainGroupCode,
    };
    entry.count += 1;
    counts.set(v.dialectId, entry);
  }

  const maxCount = Math.max(...[...counts.values()].map((v) => v.count));
  const leaders = [...counts.entries()].filter(([, v]) => v.count === maxCount);

  leaders.sort((a, b) => {
    const rankA = a[1].code ? MAIN_GROUP_ORDER.indexOf(a[1].code) : 99;
    const rankB = b[1].code ? MAIN_GROUP_ORDER.indexOf(b[1].code) : 99;
    if (rankA !== rankB) return rankA - rankB;
    return a[0].localeCompare(b[0]);
  });

  return leaders[0][0];
}

export interface ExampleInput {
  sentence: string;
  sentenceKey: string;
  order: number;
}

/**
 * Contains every distinct valid example; removes only exact duplicate
 * examples after trimming, keeping the earliest by `order` and preserving
 * deterministic ordering.
 */
export function dedupeExamplesByKey(examples: ExampleInput[]): ExampleInput[] {
  const sorted = [...examples].sort((a, b) => a.order - b.order);
  const seen = new Set<string>();
  const out: ExampleInput[] = [];
  for (const e of sorted) {
    const sentence = e.sentence.trim();
    if (!sentence || seen.has(e.sentenceKey)) continue;
    seen.add(e.sentenceKey);
    out.push({ ...e, sentence });
  }
  return out;
}

// --- Bounded-batch progress orchestration --------------------------------
//
// The admin UI processes the automatic-merge backlog as a sequence of
// bounded server round trips (see runAutoMergeBatch in actions.ts) rather
// than one unbounded request — the production incident this replaced was
// exactly one request trying to process 791 groups in a single transaction
// and exceeding every timeout layer before anything could commit. These
// pure helpers drive the client-side progress loop without embedding any
// of that decision logic inside the React component itself.

export interface AutoMergeProgress {
  total: number;
  merged: number;
  skipped: number;
  failed: number;
  remaining: number;
}

export interface AutoMergeBatchLike {
  merged: number;
  skipped: number;
  failed: number;
  remaining: number;
  attempted: number;
}

/** Folds one more batch's result into the running progress total. `remaining` always reflects the latest batch's fresh count, never summed. */
export function accumulateAutoMergeProgress(
  prev: AutoMergeProgress,
  batch: AutoMergeBatchLike,
): AutoMergeProgress {
  return {
    total: prev.total,
    merged: prev.merged + batch.merged,
    skipped: prev.skipped + batch.skipped,
    failed: prev.failed + batch.failed,
    remaining: batch.remaining,
  };
}

/**
 * A run keeps requesting batches only while the previous one actually
 * claimed something. `attempted: 0` means nothing was left to claim —
 * either the backlog is empty or every remaining group is excluded (e.g.
 * a permanently-failing group past its retry ceiling) — so continuing
 * would spin forever without making progress.
 */
export function shouldRequestNextAutoMergeBatch(
  batch: AutoMergeBatchLike,
): boolean {
  return batch.attempted > 0;
}
