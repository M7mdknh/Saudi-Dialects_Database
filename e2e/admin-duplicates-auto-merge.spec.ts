import { test, expect } from "@playwright/test";

/**
 * Exercises the bounded-batch automatic-merge flow end to end against a
 * real local Supabase stack — the fix for a confirmed production failure
 * where processing an unbounded backlog (791 eligible groups) inside one
 * request/transaction exceeded platform timeouts before anything could
 * commit (see migration 0032). Requires the seeded admin
 * (admin-e2e@example.com) and the tracked seed.sql fixtures: sixty clean
 * exact groups ("دفعة_تلقائي_1".."دفعة_تلقائي_60") and one meaning-conflict
 * pair ("دفعة_تعارض_1").
 *
 * Kept as two tests rather than several small ones: every mutating
 * assertion (disabled-while-running, real multi-batch progress, reload
 * -mid-run resumption, completion, the conflict group staying untouched,
 * and the v4 export) shares the same one backlog run — splitting them
 * into separate tests would make the run order fragile (a later test
 * could find the backlog already drained, or a claim briefly stuck behind
 * an earlier test's abandoned page).
 */

const ADMIN_EMAIL = "admin-e2e@example.com";
const ADMIN_PASSWORD = "TestAdmin123!";

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/admin/login");
  await page.getByLabel("البريد الإلكتروني").fill(ADMIN_EMAIL);
  await page.getByLabel("كلمة المرور").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForURL(/\/admin$/, { timeout: 15_000 });
}

test.describe("automatic-merge bounded batching (live local Supabase)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "mutating suite runs once, on desktop only",
    );
    await loginAsAdmin(page);
  });

  test("shows the eligible-group preview count without mutating anything on load", async ({
    page,
  }) => {
    await page.goto("/admin/duplicates");
    const panel = page.getByTestId("auto-merge-panel");
    await expect(panel).toBeVisible();
    const countText = await panel
      .getByTestId("auto-merge-eligible-count")
      .textContent();
    // A plain GET must never merge anything — the count is a real number,
    // not zero from an accidental side-effecting read, and the meaning-
    // conflict group must still be present and unresolved.
    expect(Number(countText)).toBeGreaterThanOrEqual(60);

    await page.getByLabel("حالة الحسم").selectOption("");
    await page.getByLabel("نوع التطابق").selectOption("conflict");
    await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
    const results = page.getByTestId("duplicate-groups-list");
    await expect(
      results.locator("li", { hasText: "دفعة_تعارض_1" }),
    ).toBeVisible();
  });

  test("disables repeated clicks, shows real multi-batch progress, survives a mid-run reload, completes, and never touches the conflict group", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/admin/duplicates");

    const panel = page.getByTestId("auto-merge-panel");
    const eligibleBefore = Number(
      await panel.getByTestId("auto-merge-eligible-count").textContent(),
    );
    expect(eligibleBefore).toBeGreaterThanOrEqual(60);

    const trigger = panel.getByRole("button", {
      name: "دمج الحالات الواضحة تلقائيًا",
    });
    await trigger.click();
    await panel.getByRole("button", { name: "تأكيد" }).click();

    // While running, the trigger must not be present/clickable again — no
    // way to fire a second overlapping run from the same tab.
    await expect(trigger).toHaveCount(0);

    // Real progress across multiple bounded batches (25 per request) —
    // never one silent hang for the whole backlog.
    const progress = page.getByTestId("auto-merge-progress");
    await expect(progress).toBeVisible({ timeout: 10_000 });
    await expect(progress).toContainText(/تم دمج \d+ من \d+/);
    await expect(progress.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      /\d+/,
    );

    // Interrupt immediately with a hard reload — whatever already
    // committed must stay committed (each group is its own transaction).
    await page.reload();
    await page.waitForLoadState("networkidle");

    const afterReload = Number(
      await page
        .getByTestId("auto-merge-panel")
        .getByTestId("auto-merge-eligible-count")
        .textContent(),
    );
    expect(afterReload).toBeLessThanOrEqual(eligibleBefore);

    // Resume and finish the rest — never duplicates anything already
    // merged, and reaches true completion (not just a false "done").
    if (afterReload > 0) {
      await page
        .getByRole("button", { name: "دمج الحالات الواضحة تلقائيًا" })
        .click();
      await page.getByRole("button", { name: "تأكيد" }).click();
      await expect(page.getByTestId("auto-merge-summary")).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByTestId("auto-merge-summary")).toContainText(
        /اكتملت المعالجة/,
      );
    }

    // The meaning-conflict group must never be auto-merged.
    await page.goto("/admin/duplicates");
    await page.getByLabel("حالة الحسم").selectOption("");
    await page.getByLabel("نوع التطابق").selectOption("conflict");
    await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
    await expect(
      page
        .getByTestId("duplicate-groups-list")
        .locator("li", { hasText: "دفعة_تعارض_1" }),
    ).toBeVisible();

    // Drive to full completion: a group whose claim was still held by the
    // reloaded-away page becomes reclaimable once its short lease expires,
    // so clicking again (as a real admin would) finishes it off — this is
    // exactly the "safe to continue after an interruption" property, not
    // a passive wait.
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.goto("/admin/duplicates");
      const remaining = Number(
        await page
          .getByTestId("auto-merge-panel")
          .getByTestId("auto-merge-eligible-count")
          .textContent(),
      );
      if (remaining === 0) break;
      await page
        .getByRole("button", { name: "دمج الحالات الواضحة تلقائيًا" })
        .click();
      await page.getByRole("button", { name: "تأكيد" }).click();
      await expect(page.getByTestId("auto-merge-summary")).toBeVisible({
        timeout: 60_000,
      });
    }

    await page.goto("/admin/duplicates");
    const finalCount = Number(
      await page
        .getByTestId("auto-merge-panel")
        .getByTestId("auto-merge-eligible-count")
        .textContent(),
    );
    expect(finalCount).toBe(0);

    const exportRes = await page.request.get(
      "/api/admin/exports?schemaVersion=4&format=json",
    );
    expect(exportRes.ok()).toBe(true);
    const records = (await exportRes.json()) as { word: string }[];
    expect(records.find((r) => r.word === "دفعة_تلقائي_1")).toBeTruthy();
    expect(records.find((r) => r.word === "دفعة_تعارض_1")).toBeUndefined();
  });
});
