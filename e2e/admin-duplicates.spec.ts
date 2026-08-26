import { test, expect } from "@playwright/test";

/**
 * Exercises the duplicate-management center end to end against a real
 * local Supabase stack. Requires the seeded admin (admin-e2e@example.com)
 * and the duplicate-scenario seed data (an exact 3-way group "زعلان", a
 * meaning-conflict pair "فزع", and a fuzzy spelling pair
 * "اتمرمط"/"اترمرط") — see the Phase 2 verification notes.
 *
 * The mobile and desktop projects share one server + database and run
 * fully in parallel (see playwright.config.ts), so any test that mutates
 * duplicate-group state (resolve/merge) is restricted to the desktop
 * project only — otherwise both projects race the same row concurrently.
 * Assertions scope to the results `<ul data-testid="duplicate-groups-list">`
 * rather than the whole page — the root layout wraps every page (including
 * admin ones) in the public site's own header/footer nav, and the filter
 * `<select>` also contains the Arabic type labels as (hidden) `<option>`
 * text — both `getByRole("list").last()` (picks the footer's nav list) and
 * a bare `getByText(...)` (matches option text) are ambiguous here.
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

test.describe("duplicate-management center (live local Supabase)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("nav link shows an unresolved-groups badge", async ({ page }) => {
    await page.goto("/admin");
    const link = page.getByRole("link", { name: /التكرارات/ });
    await expect(link).toBeVisible();
    await expect(link).toContainText(/\d/);
  });

  test("lists groups with correct candidate-type classification and counts", async ({
    page,
  }) => {
    await page.goto("/admin/duplicates");
    await expect(
      page.getByRole("heading", { name: "مركز إدارة التكرارات" }),
    ).toBeVisible();

    await page.getByLabel("حالة الحسم").selectOption("");
    await page.getByLabel("نوع التطابق").selectOption("conflict");
    await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();

    const results = page.getByTestId("duplicate-groups-list");
    const fazaCard = results.locator("li", { hasText: "فزع" });
    await expect(fazaCard.getByText("تعارض في المعنى")).toBeVisible();
  });

  test("filtering by candidate type narrows the list", async ({ page }) => {
    await page.goto("/admin/duplicates");
    await page.getByLabel("حالة الحسم").selectOption("");
    await page.getByLabel("نوع التطابق").selectOption("fuzzy");
    await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();

    const results = page.getByTestId("duplicate-groups-list");
    await expect(results.getByText("تشابه محتمل").first()).toBeVisible();
    await expect(results.getByText("تعارض في المعنى")).toHaveCount(0);
    await expect(results.getByText("تطابق مباشر")).toHaveCount(0);
  });

  test("quick-resolve 'تجاهل حالياً' removes an unresolved fuzzy group from the list", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "mutating test runs once, on desktop only — mobile+desktop share one DB",
    );
    // Generous headroom: under the full suite's parallel load, the shared
    // local Postgres/PostgREST connection pool can queue this RPC well
    // past a tight timeout even though the action itself is correct.
    test.setTimeout(60_000);

    await page.goto("/admin/duplicates");
    await page.getByLabel("نوع التطابق").selectOption("fuzzy");
    await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();

    const results = page.getByTestId("duplicate-groups-list");
    const card = results.locator("li", { hasText: "اتمرمط" }).first();
    await expect(
      card.getByRole("button", { name: "تجاهل حالياً" }),
    ).toBeEnabled({ timeout: 30_000 });
    await card.getByRole("button", { name: "تجاهل حالياً" }).click();
    await expect(results.locator("li", { hasText: "اتمرمط" })).toHaveCount(0, {
      timeout: 30_000,
    });
  });

  test("multi-source merge workspace merges three sources into one canonical entry", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "mutating test runs once, on desktop only — mobile+desktop share one DB",
    );
    test.setTimeout(60_000);

    await page.goto(`/admin/duplicates/${encodeURIComponent("exact:زعلان")}`);
    await expect(
      page.getByRole("heading", { name: "مساحة الدمج" }),
    ).toBeVisible();
    const baseCandidates = page.getByTestId("base-candidates");
    await expect(baseCandidates.getByText("حجازي")).toHaveCount(2);
    await expect(baseCandidates.getByText("نجدي")).toHaveCount(1);

    await page.getByRole("button", { name: "دمج وحفظ" }).click();
    await page.waitForURL(/\/admin\/duplicates/, { timeout: 30_000 });
    // Let the router.push()-driven navigation fully settle before issuing a
    // second hard navigation to the same workspace URL — starting it while
    // the first client-side transition is still in flight can otherwise
    // leave the browser on the stale (pre-merge) render.
    await page.waitForLoadState("networkidle");

    await page.goto(`/admin/duplicates/${encodeURIComponent("exact:زعلان")}`);
    await expect(
      page.getByText(/حالة هذه المجموعة حالياً: تم الدمج/),
    ).toBeVisible({ timeout: 15_000 });
  });
});
