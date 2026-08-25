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
    render(
      <LeaderboardSection initialEntries={FIVE_GROUPS} variant="compact" />,
    );
    for (const label of ["حجازي", "نجدي", "شرقاوي", "شمالي", "جنوبي"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("links to the full leaderboard page", () => {
    render(
      <LeaderboardSection initialEntries={FIVE_GROUPS} variant="compact" />,
    );
    const link = screen.getByRole("link", { name: "عرض لوحة اللهجات" });
    expect(link).toHaveAttribute("href", "/leaderboard");
  });

  it("shows a distinct retry state instead of hiding the section when the initial load failed", async () => {
    getDialectLeaderboardMock.mockResolvedValueOnce(FIVE_GROUPS);
    const user = userEvent.setup();
    render(<LeaderboardSection initialEntries={null} variant="compact" />);

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
    render(
      <LeaderboardSection initialEntries={FIVE_GROUPS} variant="compact" />,
    );
    expect(screen.getByText("٣ مساهمات")).toBeInTheDocument();

    const { notifyLeaderboardUpdated } = await import("./refresh-event");
    notifyLeaderboardUpdated();

    await waitFor(() =>
      expect(screen.getByText("٤ مساهمات")).toBeInTheDocument(),
    );
  });

  it("announces the change through an accessible live region after a refresh increases a count", async () => {
    getDialectLeaderboardMock.mockResolvedValueOnce([
      { ...FIVE_GROUPS[0], submissionCount: 6 },
      ...FIVE_GROUPS.slice(1),
    ]);
    render(
      <LeaderboardSection initialEntries={FIVE_GROUPS} variant="compact" />,
    );

    const { notifyLeaderboardUpdated } = await import("./refresh-event");
    notifyLeaderboardUpdated();

    await waitFor(() => {
      const status = document.querySelector('[aria-live="polite"]');
      expect(status?.textContent).toContain("حجازي");
      expect(status?.textContent).toMatch(/أُضيف/);
    });
  });

  it("does not announce or highlight anything when a refresh reports no change", async () => {
    getDialectLeaderboardMock.mockResolvedValueOnce(FIVE_GROUPS);
    render(
      <LeaderboardSection initialEntries={FIVE_GROUPS} variant="compact" />,
    );

    const { notifyLeaderboardUpdated } = await import("./refresh-event");
    notifyLeaderboardUpdated();

    await waitFor(() => expect(getDialectLeaderboardMock).toHaveBeenCalled());
    const status = document.querySelector('[aria-live="polite"]');
    expect(status?.textContent ?? "").toBe("");
  });
});

describe("LeaderboardSection (full page)", () => {
  it("shows the full-page heading and aggregate statistics", () => {
    render(<LeaderboardSection initialEntries={FIVE_GROUPS} variant="full" />);
    expect(
      screen.getByRole("heading", { name: "لوحة صدارة اللهجات" }),
    ).toBeInTheDocument();
    expect(screen.getByText("إجمالي المساهمات")).toBeInTheDocument();
    expect(screen.getByText("الكلمات المعتمدة")).toBeInTheDocument();
  });

  it("uses distinct call-to-action copy from the homepage preview", () => {
    render(<LeaderboardSection initialEntries={FIVE_GROUPS} variant="full" />);
    expect(
      screen.getByRole("link", { name: "أضف نقطة للهجتك" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "عرض لوحة اللهجات" }),
    ).not.toBeInTheDocument();
  });
});
