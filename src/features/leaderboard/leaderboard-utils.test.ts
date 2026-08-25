import { describe, expect, it } from "vitest";
import type { LeaderboardEntry } from "./actions";
import {
  computeGapFromLeaderMessage,
  computeHeadlineMessage,
  computeStats,
  groupProgress,
  hasCompetitionStarted,
  isTiedForFirst,
} from "./leaderboard-utils";

function entry(overrides: Partial<LeaderboardEntry>): LeaderboardEntry {
  return {
    mainGroupCode: "hijazi",
    mainGroupLabelAr: "حجازي",
    submissionCount: 0,
    approvedWordCount: 0,
    rank: 1,
    ...overrides,
  };
}

// Competition ranking (100, 80, 80, 40, 20 -> 1, 2, 2, 4, 5) is computed by
// the public_dialect_leaderboard() SQL function (RANK() OVER, see
// 0019_participation_leaderboard.sql) — these entries just reflect that
// authoritative shape for the pure UI-side logic under test here.
const DISTINCT_RANKS: LeaderboardEntry[] = [
  entry({
    mainGroupCode: "hijazi",
    mainGroupLabelAr: "حجازي",
    submissionCount: 100,
    rank: 1,
  }),
  entry({
    mainGroupCode: "najdi",
    mainGroupLabelAr: "نجدي",
    submissionCount: 80,
    rank: 2,
  }),
  entry({
    mainGroupCode: "eastern",
    mainGroupLabelAr: "شرقاوي",
    submissionCount: 40,
    rank: 3,
  }),
  entry({
    mainGroupCode: "northern",
    mainGroupLabelAr: "شمالي",
    submissionCount: 20,
    rank: 4,
  }),
  entry({
    mainGroupCode: "southern",
    mainGroupLabelAr: "جنوبي",
    submissionCount: 10,
    rank: 5,
  }),
];

const TIED_FOR_SECOND: LeaderboardEntry[] = [
  entry({
    mainGroupCode: "hijazi",
    mainGroupLabelAr: "حجازي",
    submissionCount: 100,
    rank: 1,
  }),
  entry({
    mainGroupCode: "najdi",
    mainGroupLabelAr: "نجدي",
    submissionCount: 80,
    rank: 2,
  }),
  entry({
    mainGroupCode: "eastern",
    mainGroupLabelAr: "شرقاوي",
    submissionCount: 80,
    rank: 2,
  }),
  entry({
    mainGroupCode: "northern",
    mainGroupLabelAr: "شمالي",
    submissionCount: 40,
    rank: 4,
  }),
  entry({
    mainGroupCode: "southern",
    mainGroupLabelAr: "جنوبي",
    submissionCount: 20,
    rank: 5,
  }),
];

const TIED_FOR_FIRST: LeaderboardEntry[] = [
  entry({
    mainGroupCode: "hijazi",
    mainGroupLabelAr: "حجازي",
    submissionCount: 50,
    rank: 1,
  }),
  entry({
    mainGroupCode: "najdi",
    mainGroupLabelAr: "نجدي",
    submissionCount: 50,
    rank: 1,
  }),
  entry({
    mainGroupCode: "eastern",
    mainGroupLabelAr: "شرقاوي",
    submissionCount: 10,
    rank: 3,
  }),
  entry({
    mainGroupCode: "northern",
    mainGroupLabelAr: "شمالي",
    submissionCount: 5,
    rank: 4,
  }),
  entry({
    mainGroupCode: "southern",
    mainGroupLabelAr: "جنوبي",
    submissionCount: 0,
    rank: 5,
  }),
];

const ALL_ZERO: LeaderboardEntry[] = [
  entry({ mainGroupCode: "hijazi", mainGroupLabelAr: "حجازي", rank: 1 }),
  entry({ mainGroupCode: "najdi", mainGroupLabelAr: "نجدي", rank: 1 }),
  entry({ mainGroupCode: "eastern", mainGroupLabelAr: "شرقاوي", rank: 1 }),
  entry({ mainGroupCode: "northern", mainGroupLabelAr: "شمالي", rank: 1 }),
  entry({ mainGroupCode: "southern", mainGroupLabelAr: "جنوبي", rank: 1 }),
];

describe("hasCompetitionStarted / isTiedForFirst", () => {
  it("reports no competition when every group is zero", () => {
    expect(hasCompetitionStarted(ALL_ZERO)).toBe(false);
  });
  it("reports competition once any group has a submission", () => {
    expect(hasCompetitionStarted(DISTINCT_RANKS)).toBe(true);
  });
  it("is not tied for first with a sole leader", () => {
    expect(isTiedForFirst(DISTINCT_RANKS)).toBe(false);
  });
  it("is tied for first when two groups share rank 1 with a nonzero count", () => {
    expect(isTiedForFirst(TIED_FOR_FIRST)).toBe(true);
  });
  it("all-zero groups sharing rank 1 do not count as a real tie", () => {
    expect(isTiedForFirst(ALL_ZERO)).toBe(false);
  });
});

describe("computeStats", () => {
  it("sums totals and counts participating groups", () => {
    const stats = computeStats(DISTINCT_RANKS);
    expect(stats.totalSubmissions).toBe(100 + 80 + 40 + 20 + 10);
    expect(stats.participatingGroups).toBe(5);
  });
  it("computes the leader gap against the true rank-2 group", () => {
    expect(computeStats(DISTINCT_RANKS).leaderGap).toBe(20);
    expect(computeStats(TIED_FOR_SECOND).leaderGap).toBe(20);
  });
  it("reports a null gap when tied for first", () => {
    expect(computeStats(TIED_FOR_FIRST).leaderGap).toBeNull();
  });
  it("reports a null gap when nobody has submitted", () => {
    expect(computeStats(ALL_ZERO).leaderGap).toBeNull();
  });
});

describe("computeHeadlineMessage", () => {
  it("shows the shared starting state when every group is zero", () => {
    expect(computeHeadlineMessage(ALL_ZERO)).toBe("المنافسة تبدأ بأول مساهمة");
  });
  it("names the true leader and the authoritative gap, never hardcoded", () => {
    expect(computeHeadlineMessage(DISTINCT_RANKS)).toBe(
      "يتصدر حجازي بفارق ٢٠ مساهمة",
    );
  });
  it("labels a shared lead instead of picking a false champion", () => {
    expect(computeHeadlineMessage(TIED_FOR_FIRST)).toBe(
      "تعادل حجازي ونجدي على الصدارة",
    );
  });
});

describe("computeGapFromLeaderMessage", () => {
  it("is empty for the leader itself", () => {
    expect(computeGapFromLeaderMessage(DISTINCT_RANKS[0], DISTINCT_RANKS)).toBe(
      "",
    );
  });
  it("reports an accurate distance-to-leader for a trailing group", () => {
    expect(computeGapFromLeaderMessage(DISTINCT_RANKS[1], DISTINCT_RANKS)).toBe(
      "تفصل النجدية ٢٠ مساهمة عن الصدارة",
    );
  });
  it("is empty before any submission exists", () => {
    expect(computeGapFromLeaderMessage(ALL_ZERO[1], ALL_ZERO)).toBe("");
  });
});

describe("groupProgress", () => {
  it("gives the leader 100%", () => {
    expect(groupProgress(DISTINCT_RANKS[0], DISTINCT_RANKS)).toBe(1);
  });
  it("scales trailing groups relative to the leader", () => {
    expect(groupProgress(DISTINCT_RANKS[1], DISTINCT_RANKS)).toBeCloseTo(0.8);
  });
  it("never divides by zero when every group is zero", () => {
    for (const e of ALL_ZERO) expect(groupProgress(e, ALL_ZERO)).toBe(0);
  });
});
