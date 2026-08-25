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
  { mainGroupCode: "hijazi", mainGroupLabelAr: "حجازي", approvedWordCount: 3 },
  { mainGroupCode: "najdi", mainGroupLabelAr: "نجدي", approvedWordCount: 0 },
  {
    mainGroupCode: "eastern",
    mainGroupLabelAr: "شرقاوي",
    approvedWordCount: 0,
  },
  {
    mainGroupCode: "northern",
    mainGroupLabelAr: "شمالي",
    approvedWordCount: 0,
  },
  {
    mainGroupCode: "southern",
    mainGroupLabelAr: "جنوبي",
    approvedWordCount: 0,
  },
];

describe("LeaderboardSection (homepage preview)", () => {
  it("shows all five main groups even when four have zero approved words", () => {
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
});
