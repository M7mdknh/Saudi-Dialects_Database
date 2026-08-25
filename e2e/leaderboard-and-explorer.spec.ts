import { test, expect } from "@playwright/test";

// Real-backend journeys (see guided-contribution.spec.ts for the same
// caveat): if the backend isn't reachable the leaderboard/explorer pages
// throw, so these tests first confirm the page rendered before asserting on
// content.

async function leaderboardReachable(page: import("@playwright/test").Page) {
  const response = await page.goto("/leaderboard");
  return Boolean(response && response.ok());
}

test.describe("public leaderboard and dialect explorer", () => {
  test("the leaderboard shows all five main Saudi dialect groups ranked by approved word count", async ({
    page,
  }) => {
    test.skip(
      !(await leaderboardReachable(page)),
      "Leaderboard backend not reachable in this environment.",
    );

    await expect(
      page.getByRole("heading", { name: "أي لهجة جمعت مساهمات أكثر؟" }),
    ).toBeVisible();
    for (const label of ["حجازي", "نجدي", "شرقاوي", "شمالي", "جنوبي"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test("exploring a dialect from the leaderboard navigates to its approved-words page", async ({
    page,
  }) => {
    test.skip(
      !(await leaderboardReachable(page)),
      "Leaderboard backend not reachable in this environment.",
    );

    await page.getByRole("link", { name: "استكشف" }).first().click();
    await expect(page).toHaveURL(
      /\/dialects\/(hijazi|najdi|eastern|northern|southern)/,
    );
    await expect(
      page.getByRole("heading", { name: /كلمات مميزة من اللهجة/ }),
    ).toBeVisible();
  });

  test("the explorer page never exposes pending/rejected fields and offers a contribute action", async ({
    page,
  }) => {
    const response = await page.goto("/dialects/hijazi");
    test.skip(
      !(response && response.ok()),
      "Explorer backend not reachable in this environment.",
    );

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("review_status");
    expect(bodyText).not.toContain("editorial_status");
    expect(bodyText).not.toContain("abuse_hash");

    await expect(
      page.getByRole("link", { name: "ساهم بكلمة من هذه اللهجة" }),
    ).toBeVisible();
  });

  test("searching for a term that matches nothing shows the no-results state, not an error", async ({
    page,
  }) => {
    const response = await page.goto("/dialects/hijazi");
    test.skip(
      !(response && response.ok()),
      "Explorer backend not reachable in this environment.",
    );

    await page
      .getByPlaceholder("ابحث بالكلمة أو المرادف الفصيح")
      .fill("كلمةغيرموجودةإطلاقاً١٢٣");
    await page.getByRole("button", { name: "بحث" }).click();

    await expect(page.getByText("لا توجد نتائج مطابقة لبحثك.")).toBeVisible();
  });

  test("an unknown dialect slug returns a 404, not a crash", async ({
    page,
  }) => {
    const response = await page.goto("/dialects/not-a-real-dialect");
    expect(response?.status()).toBe(404);
  });
});
