import { test, expect } from "@playwright/test";

/**
 * Exercises the export panel end to end against a real local Supabase
 * stack. Requires a seeded admin user (admin-e2e@example.com) and at least
 * one approved canonical entry per main dialect group — see the Phase 1
 * verification notes for the exact seed data. Skipped automatically if
 * that admin can't sign in (no live local Supabase stack available).
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

test.describe("admin export panel (live local Supabase)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("opens the export panel and previews the v4 schema by default", async ({
    page,
  }) => {
    await page.goto("/admin/exports");
    await expect(
      page.getByRole("heading", { name: "تصدير البيانات" }),
    ).toBeVisible();
    await expect(page.getByLabel("إصدار مخطط التصدير")).toHaveValue("4");

    await page.getByRole("button", { name: "معاينة عدد السجلات" }).click();
    await expect(page.getByText(/عدد السجلات القابلة للتصدير/)).toBeVisible();
    await expect(page.getByText("التوزيع حسب اللهجة الرئيسية:")).toBeVisible();
  });

  test("downloads a valid v4 JSON file (plain array, no envelope)", async ({
    page,
  }) => {
    await page.goto("/admin/exports");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "تنزيل JSON", exact: true }).click(),
    ]);
    const streamPath = await download.path();
    expect(streamPath).toBeTruthy();
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(streamPath!, "utf-8");
    const parsed = JSON.parse(content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).not.toHaveProperty("schema_version");
    expect(Object.keys(parsed[0])).toEqual([
      "word",
      "word_key",
      "concept_id",
      "meaning",
      "msa_synonyms",
      "dialects",
      "local_dialects",
      "examples",
      "related_words",
      "register",
    ]);
  });

  test("downloads a valid ALLaM training JSONL file", async ({ page }) => {
    await page.goto("/admin/exports");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "تنزيل ALLaM Training JSONL" }).click(),
    ]);
    const streamPath = await download.path();
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(streamPath!, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(Object.keys(parsed).sort()).toEqual([
        "dialect",
        "instruction",
        "response",
      ]);
      expect(["HIJAZI", "NAJDI", "EASTERN", "NORTHERN", "SOUTHERN"]).toContain(
        parsed.dialect,
      );
    }
  });

  test("dialect filter narrows the preview, clearing it restores the full count", async ({
    page,
  }) => {
    await page.goto("/admin/exports");
    await page.getByRole("button", { name: "معاينة عدد السجلات" }).click();
    const allText = await page
      .getByText(/عدد السجلات القابلة للتصدير/)
      .textContent();
    const allCount = Number(allText?.match(/\d+/)?.[0]);
    expect(allCount).toBeGreaterThan(0);

    await page.getByLabel("اللهجة المعتمدة").selectOption({ label: "مديني" });
    await page.getByRole("button", { name: "معاينة عدد السجلات" }).click();
    const filteredText = await page
      .getByText(/عدد السجلات القابلة للتصدير/)
      .textContent();
    const filteredCount = Number(filteredText?.match(/\d+/)?.[0]);
    expect(filteredCount).toBeLessThan(allCount);
    expect(filteredCount).toBeGreaterThan(0);

    await page.getByRole("button", { name: "مسح الفلاتر" }).click();
    await page.getByRole("button", { name: "معاينة عدد السجلات" }).click();
    const restoredText = await page
      .getByText(/عدد السجلات القابلة للتصدير/)
      .textContent();
    expect(Number(restoredText?.match(/\d+/)?.[0])).toBe(allCount);
  });

  test("all-dialects export includes every seeded main group, never collapsing to one", async ({
    page,
  }) => {
    await page.goto("/admin/exports");
    await page.getByRole("button", { name: "معاينة عدد السجلات" }).click();
    await expect(page.getByText("حجازي:")).toBeVisible();
    await expect(page.getByText("نجدي:")).toBeVisible();
    await expect(page.getByText("شرقاوي:")).toBeVisible();
    await expect(page.getByText("شمالي:")).toBeVisible();
    await expect(page.getByText("جنوبي:")).toBeVisible();
  });

  test("mainGroupCode is enforced through the real API + RLS-authorized session, not just pure functions", async ({
    page,
  }) => {
    // Reuses the already-authenticated browser context's cookies via
    // page.request — this is the real requireAdmin() → RLS → PostgREST path,
    // not a mock.
    const all = await page.request.get(
      "/api/admin/exports?schemaVersion=4&preview=1",
    );
    expect(all.ok()).toBe(true);
    const allBody = await all.json();
    expect(Object.keys(allBody.countsByMainDialect).length).toBeGreaterThan(1);

    const hijaziOnly = await page.request.get(
      "/api/admin/exports?schemaVersion=4&preview=1&mainGroupCode=hijazi",
    );
    expect(hijaziOnly.ok()).toBe(true);
    const hijaziBody = await hijaziOnly.json();
    expect(Object.keys(hijaziBody.countsByMainDialect)).toEqual(["hijazi"]);
    expect(hijaziBody.recordCount).toBeLessThan(allBody.recordCount);
    expect(hijaziBody.recordCount).toBeGreaterThan(0);

    // Invalid main group code is rejected server-side, not silently ignored.
    const invalid = await page.request.get(
      "/api/admin/exports?schemaVersion=4&preview=1&mainGroupCode=egyptian",
    );
    expect(invalid.status()).toBe(400);
  });
});
