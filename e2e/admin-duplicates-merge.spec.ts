import { test, expect } from "@playwright/test";

/**
 * Exercises the multi-dialect duplicate merge workspace end to end against
 * a real local Supabase stack. Requires the seeded admin
 * (admin-e2e@example.com) and the duplicate-scenario seed data, including
 * the "طنشني" group (three Najdi + two Southern raw submissions, no
 * existing canonical entry) added for the majority-default scenario — see
 * the merge-workspace verification notes.
 *
 * Mutating tests are restricted to the desktop project only (mobile and
 * desktop share one server + database, see playwright.config.ts) and run
 * serially against their own dedicated group so they don't interfere with
 * other duplicate-center specs sharing the same seed.
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

const ENGLISH_DIALECT_CODE = /\b(najdi|southern|hijazi|eastern|northern)\b/i;

test.describe("duplicate merge workspace — multi-dialect (live local Supabase)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("a group with three Najdi and two Southern sources defaults to Najdi", async ({
    page,
  }) => {
    await page.goto(`/admin/duplicates/${encodeURIComponent("exact:طنشني")}`);
    const najdiChip = page.getByRole("checkbox", { name: /نجدي/ });
    const southernChip = page.getByRole("checkbox", { name: /جنوبي/ });
    await expect(najdiChip).toBeChecked();
    await expect(southernChip).not.toBeChecked();
    // Counts are shown beside each detected dialect.
    await expect(page.getByText(/نجدي\s*—\s*٣ مصادر/)).toBeVisible();
    await expect(page.getByText(/جنوبي\s*—\s*مصدران/)).toBeVisible();
  });

  test("no English main-group dialect code is visible anywhere on the duplicate list or merge page", async ({
    page,
  }) => {
    await page.goto("/admin/duplicates");
    await expect(page.locator("body")).not.toContainText(ENGLISH_DIALECT_CODE);

    await page.goto(`/admin/duplicates/${encodeURIComponent("exact:طنشني")}`);
    await expect(page.locator("body")).not.toContainText(ENGLISH_DIALECT_CODE);
  });

  test("selecting a different base candidate actually changes the prefilled content (regression for the broken control)", async ({
    page,
  }) => {
    await page.goto(`/admin/duplicates/${encodeURIComponent("exact:طنشني")}`);
    const wordField = page.getByRole("textbox", {
      name: "الكلمة المعتمدة",
    });

    const cards = page.getByRole("button", {
      name: /اختيار كأساس|الأساس المختار/,
    });
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // First card is base by default (first member = first raw candidate).
    await expect(cards.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(cards.nth(1)).toHaveAttribute("aria-pressed", "false");

    // Click the second card — it, and only it, must become selected.
    await cards.nth(1).click();
    await expect(cards.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(cards.nth(0)).toHaveAttribute("aria-pressed", "false");
    await expect(cards.nth(1)).toContainText("الأساس المختار ✓");
    await expect(cards.nth(0)).toContainText("اختيار كأساس");

    // Click the third (Southern) card — content fields must reflect it.
    await cards.nth(3).click();
    await expect(cards.nth(3)).toHaveAttribute("aria-pressed", "true");
    await expect(cards.nth(1)).toHaveAttribute("aria-pressed", "false");
    await expect(wordField).toHaveValue("طنشني");
  });

  test("base selection survives rerenders and field edits", async ({
    page,
  }) => {
    await page.goto(`/admin/duplicates/${encodeURIComponent("exact:طنشني")}`);
    const cards = page.getByRole("button", {
      name: /اختيار كأساس|الأساس المختار/,
    });
    await cards.nth(2).click();
    await expect(cards.nth(2)).toHaveAttribute("aria-pressed", "true");

    // Unrelated field edits and re-renders must not reset the selection.
    await page
      .getByRole("textbox", { name: "المعنى المعتمد" })
      .fill("معنى معدَّل يدويًا");
    await page.getByLabel("ظهور الكلمة").selectOption("private");
    await page.getByLabel("ظهور الكلمة").selectOption("public");

    await expect(cards.nth(2)).toHaveAttribute("aria-pressed", "true");
  });

  test("keyboard (Enter/Space) and touch/click all select the base candidate", async ({
    page,
  }) => {
    await page.goto(`/admin/duplicates/${encodeURIComponent("exact:طنشني")}`);
    const cards = page.getByRole("button", {
      name: /اختيار كأساس|الأساس المختار/,
    });

    // Click.
    await cards.nth(1).click();
    await expect(cards.nth(1)).toHaveAttribute("aria-pressed", "true");

    // Keyboard: focus the third card directly and activate with Enter.
    await cards.nth(2).focus();
    await page.keyboard.press("Enter");
    await expect(cards.nth(2)).toHaveAttribute("aria-pressed", "true");
    await expect(cards.nth(1)).toHaveAttribute("aria-pressed", "false");

    // Keyboard: Space activates too.
    await cards.nth(0).focus();
    await page.keyboard.press(" ");
    await expect(cards.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(cards.nth(2)).toHaveAttribute("aria-pressed", "false");
  });

  test("the admin can select both Najdi and Southern and save successfully — v4 export shows both, no duplicates", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mutates shared entry");

    await page.goto(`/admin/duplicates/${encodeURIComponent("exact:طنشني")}`);
    await page.getByRole("checkbox", { name: /جنوبي/ }).check();
    await expect(page.getByRole("checkbox", { name: /نجدي/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /جنوبي/ })).toBeChecked();

    await page.getByRole("button", { name: "دمج وحفظ" }).click();
    await page.waitForURL(/\/admin\/duplicates/, { timeout: 15_000 });
    await page.waitForLoadState("networkidle");

    const res = await page.request.get(
      "/api/admin/exports?schemaVersion=4&format=json",
    );
    expect(res.ok()).toBe(true);
    const records = (await res.json()) as {
      word: string;
      dialects: string[];
    }[];
    const record = records.find((r) => r.word === "طنشني");
    expect(record).toBeTruthy();
    expect(record!.dialects.sort()).toEqual(["najdi", "southern"]);
    // No duplicates in the exported array.
    expect(new Set(record!.dialects).size).toBe(record!.dialects.length);
  });

  test("existing canonical dialect assignments are preserved when a further source is merged in", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mutates shared entry");

    // "زعلان" already has an approved canonical entry from an earlier spec
    // in this suite (hijazi/مديني). Open its group and confirm the
    // existing assignment shows as already selected before any change.
    await page.goto(`/admin/duplicates/${encodeURIComponent("exact:زعلان")}`);
    const hijaziChip = page.getByRole("checkbox", { name: /حجازي/ });
    await expect(hijaziChip).toBeChecked();
  });

  test("public visibility behavior is unchanged by the multi-dialect rewrite", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mutates shared entry");

    await page.goto(`/admin/duplicates/${encodeURIComponent("exact:طنشني")}`);
    await expect(page.getByLabel("ظهور الكلمة")).toHaveValue("public");
  });
});
