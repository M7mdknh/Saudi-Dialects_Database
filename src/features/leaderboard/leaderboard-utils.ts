import type { LeaderboardEntry } from "./actions";
import {
  formatParticipationCount,
  formatParticipationCountGenitive,
} from "./format";

/** Bare feminine adjective — used when another noun (e.g. "اللهجتان") already anchors the phrase. */
export const MAIN_GROUP_FEMININE_LABELS: Record<string, string> = {
  hijazi: "الحجازية",
  najdi: "النجدية",
  eastern: "الشرقاوية",
  northern: "الشمالية",
  southern: "الجنوبية",
};

/** Full grammatical display name ("اللهجة الحجازية") — explicit, not derived by concatenating the short label. */
export const MAIN_GROUP_DISPLAY_NAMES: Record<string, string> = {
  hijazi: "اللهجة الحجازية",
  najdi: "اللهجة النجدية",
  eastern: "اللهجة الشرقاوية",
  northern: "اللهجة الشمالية",
  southern: "اللهجة الجنوبية",
};

export interface LeaderboardStats {
  totalSubmissions: number;
  totalApproved: number;
  participatingGroups: number;
  /** Gap between the sole leader and the runner-up. Null when there is no
   * single leader yet (competition hasn't started, or a tie for first). */
  leaderGap: number | null;
}

/** `entries` is expected pre-sorted by rank (as returned by public_dialect_leaderboard). */
export function computeStats(entries: LeaderboardEntry[]): LeaderboardStats {
  const totalSubmissions = entries.reduce((s, e) => s + e.submissionCount, 0);
  const totalApproved = entries.reduce((s, e) => s + e.approvedWordCount, 0);
  const participatingGroups = entries.filter(
    (e) => e.submissionCount > 0,
  ).length;
  const leaders = entries.filter((e) => e.rank === 1 && e.submissionCount > 0);
  let leaderGap: number | null = null;
  if (leaders.length === 1) {
    const second = entries.find((e) => e.rank === 2);
    leaderGap = leaders[0].submissionCount - (second?.submissionCount ?? 0);
  }
  return { totalSubmissions, totalApproved, participatingGroups, leaderGap };
}

export function hasCompetitionStarted(entries: LeaderboardEntry[]): boolean {
  return entries.some((e) => e.submissionCount > 0);
}

export function isTiedForFirst(entries: LeaderboardEntry[]): boolean {
  return (
    entries.filter((e) => e.rank === 1 && e.submissionCount > 0).length > 1
  );
}

/**
 * Headline competitive-context sentence, computed purely from authoritative
 * counts — never a hardcoded dialect name. Empty string only when the input
 * is empty (never happens: the RPC always returns all five groups).
 */
export function computeHeadlineMessage(entries: LeaderboardEntry[]): string {
  if (entries.length === 0) return "";
  if (!hasCompetitionStarted(entries)) return "المنافسة تبدأ بأول مساهمة.";
  if (isTiedForFirst(entries)) {
    const tied = entries.filter((e) => e.rank === 1);
    if (tied.length === 2) {
      const [a, b] = tied.map(
        (e) =>
          MAIN_GROUP_FEMININE_LABELS[e.mainGroupCode] ?? e.mainGroupLabelAr,
      );
      return `تتعادل اللهجتان ${a} و${b} في الصدارة.`;
    }
    return "تتعادل عدة لهجات في الصدارة.";
  }
  const leader = entries.find((e) => e.rank === 1);
  const { leaderGap } = computeStats(entries);
  if (!leader || leaderGap === null || leaderGap === 0)
    return "تتعادل عدة لهجات في الصدارة.";
  const label =
    MAIN_GROUP_DISPLAY_NAMES[leader.mainGroupCode] ?? leader.mainGroupLabelAr;
  return `تتصدر ${label} بفارق ${formatParticipationCountGenitive(leaderGap)}.`;
}

/**
 * Per-card distance-to-leader message for a non-leading group. Empty string
 * when not applicable (the leader itself, a tie, or the competition hasn't
 * started yet).
 */
export function computeGapFromLeaderMessage(
  entry: LeaderboardEntry,
  entries: LeaderboardEntry[],
): string {
  if (!hasCompetitionStarted(entries)) return "";
  if (entry.rank === 1) return "";
  const leader = entries.find((e) => e.rank === 1);
  if (!leader) return "";
  const gap = leader.submissionCount - entry.submissionCount;
  if (gap <= 0) return "";
  const label =
    MAIN_GROUP_FEMININE_LABELS[entry.mainGroupCode] ?? entry.mainGroupLabelAr;
  return `تفصل ${label} ${formatParticipationCount(gap)} عن الصدارة`;
}

/** 0..1, always 0 when nobody has submitted yet — never a misleading full bar. */
export function groupProgress(
  entry: LeaderboardEntry,
  entries: LeaderboardEntry[],
): number {
  const highest = Math.max(0, ...entries.map((e) => e.submissionCount));
  if (highest === 0) return 0;
  return Math.min(1, entry.submissionCount / highest);
}
