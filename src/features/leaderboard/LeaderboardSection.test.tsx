import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LeaderboardEntry } from "./actions";

const getDialectLeaderboardMock = vi.fn();
vi.mock("./actions", () => ({
  getDialectLeaderboard: (...args: unknown[]) =>
    getDialectLeaderboardMock(...args),
}));

const { LeaderboardSection } = await import("./LeaderboardSection");

const FIVE_GROUPS: LeaderboardEntry[] = [
  {
    mainGroupCode: "hijazi",
    mainGroupLabelAr: "حجازي",
    submissionCount: 3,
    approvedWordCount: 1,
    rank: 1,
  },
  {
    mainGroupCode: "najdi",
    mainGroupLabelAr: "نجدي",
    submissionCount: 0,
    approvedWordCount: 0,
    rank: 2,
  },
  {
    mainGroupCode: "eastern",
    mainGroupLabelAr: "شرقاوي",
    submissionCount: 0,
    approvedWordCount: 0,
    rank: 2,
  },
  {
    mainGroupCode: "northern",
    mainGroupLabelAr: "شمالي",
    submissionCount: 0,
    approvedWordCount: 0,
    rank: 2,
  },
  {
    mainGroupCode: "southern",
    mainGroupLabelAr: "جنوبي",
    submissionCount: 0,
    approvedWordCount: 0,
    rank: 2,
  },
];

describe("LeaderboardSection (homepage preview)", () => {
  it("shows all five main groups even when four have zero participation", () => {
    render(<LeaderboardSection initialEntries={FIVE_GROUPS} />);
    for (const label of ["حجازي", "نجدي", "شرقاوي", "شمالي", "جنوبي"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("links to the full leaderboard page", () => {
    render(<LeaderboardSection initialEntries={FIVE_GROUPS} />);
    const link = screen.getByRole("link", { name: "عرض لوحة اللهجات" });
    expect(link).toHaveAttribute("href", "/leaderboard");
  });

  it("shows a distinct retry state instead of hiding the section when the initial load failed", async () => {
    getDialectLeaderboardMock.mockResolvedValueOnce(FIVE_GROUPS);
    const user = userEvent.setup();
    render(<LeaderboardSection initialEntries={null} />);

    expect(
      screen.getByText("تعذّر تحميل لوحة الصدارة الآن."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "إعادة المحاولة" }));

    await waitFor(() => expect(screen.getByText("حجازي")).toBeInTheDocument());
  });

  it("refetches when the leaderboard-updated event fires (e.g. after a successful submission)", async () => {
    getDialectLeaderboardMock.mockResolvedValueOnce([
      { ...FIVE_GROUPS[0], submissionCount: 4 },
      ...FIVE_GROUPS.slice(1),
    ]);
    render(<LeaderboardSection initialEntries={FIVE_GROUPS} />);
    expect(screen.getByText("٣ مساهمات")).toBeInTheDocument();

    const { notifyLeaderboardUpdated } = await import("./refresh-event");
    notifyLeaderboardUpdated();

    await waitFor(() =>
      expect(screen.getByText("٤ مساهمات")).toBeInTheDocument(),
    );
  });
});
