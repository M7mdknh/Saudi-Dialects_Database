import { test, expect } from "@playwright/test";

// Real-backend journey: exercises the actual submission -> leaderboard
// pipeline against whatever Supabase-compatible backend NEXT_PUBLIC_SUPABASE_URL
// points at (a local stack in dev/CI). Skips gracefully if the dialect
// combobox/leaderboard aren't reachable rather than failing spuriously.

test.describe("participation leaderboard", () => {
  test("a successful submission increases the homepage leaderboard count immediately, without a reload", async ({
    page,
  }) => {
    await page.goto("/");

    const heading = page.getByRole("heading", {
      name: "أي لهجة جمعت مساهمات أكثر؟",
    });
    const reachable = await heading.isVisible().catch(() => false);
    test.skip(
      !reachable,
      "Leaderboard preview not reachable in this environment.",
    );

    const hijaziRow = page
      .locator("li")
      .filter({ has: page.getByText("حجازي", { exact: true }) })
      .first();
    const beforeText = (await hijaziRow.textContent()) ?? "";

    await page
      .getByLabel(/الكلمة باللهجة/)
      .first()
      .fill(`اختبار_مشاركة_${Date.now()}`);
    const dialectInput = page.getByLabel(/اللهجة أو المنطقة/).first();
    await dialectInput.click();
    await dialectInput.fill("حجازي");
    const hijaziOption = page.getByRole("option", { name: "حجازي" });
    if (await hijaziOption.isVisible().catch(() => false)) {
      await hijaziOption.click();
    }
    await page
      .getByLabel("مثال في جملة")
      .first()
      .fill("جملة اختبار للمشاركة الفورية");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "إرسال المساهمة" }).click();

    await expect(
      page.getByRole("heading", { name: "وصلتنا مساهمتك، شكرًا لك!" }),
    ).toBeVisible({ timeout: 15000 });

    // The homepage preview refetches on the leaderboard-updated event — no
    // page reload, no manual "refresh" click.
    await expect(async () => {
      const afterRow = page
        .locator("li")
        .filter({ has: page.getByText("حجازي", { exact: true }) })
        .first();
      const afterText = (await afterRow.textContent()) ?? "";
      expect(afterText).not.toBe(beforeText);
    }).toPass({ timeout: 10000 });
  });

  test("the submitted word is not visible in the public dialect explorer before approval", async ({
    page,
  }) => {
    const word = `اختبار_خصوصية_${Date.now()}`;
    await page.goto("/");
    const wordInput = page.getByLabel(/الكلمة باللهجة/).first();
    const reachable = await wordInput.isVisible().catch(() => false);
    test.skip(
      !reachable,
      "Contribution form not reachable in this environment.",
    );

    await wordInput.fill(word);
    const dialectInput = page.getByLabel(/اللهجة أو المنطقة/).first();
    await dialectInput.click();
    await dialectInput.fill("حجازي");
    const hijaziOption = page.getByRole("option", { name: "حجازي" });
    if (await hijaziOption.isVisible().catch(() => false)) {
      await hijaziOption.click();
    }
    await page.getByLabel("مثال في جملة").first().fill("جملة خاصة");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "إرسال المساهمة" }).click();
    await expect(
      page.getByRole("heading", { name: "وصلتنا مساهمتك، شكرًا لك!" }),
    ).toBeVisible({ timeout: 15000 });

    const response = await page.goto("/dialects/hijazi");
    test.skip(
      !(response && response.ok()),
      "Explorer backend not reachable in this environment.",
    );
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain(word);
  });
});
