import { test, expect } from "@playwright/test";

/**
 * Exercises the full canonical dictionary editor end to end against a real
 * local Supabase stack. Requires the seeded admin (admin-e2e@example.com)
 * and the approved "اتمرمط" canonical entry — see the Phase 3 verification
 * notes. Mutating tests are restricted to the desktop project only (mobile
 * and desktop share one server + database, see playwright.config.ts).
 */

const ADMIN_EMAIL = "admin-e2e@example.com";
const ADMIN_PASSWORD = "TestAdmin123!";
const ENTRY_ID = "22222222-2222-2222-2222-222222222222";

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/admin/login");
  await page.getByLabel("البريد الإلكتروني").fill(ADMIN_EMAIL);
  await page.getByLabel("كلمة المرور").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "دخول" }).click();
  await page.waitForURL(/\/admin$/, { timeout: 15_000 });
}

test.describe("dictionary editor (live local Supabase)", () => {
  // Several tests mutate the same seeded entry sequentially (meaning,
  // dialects, visibility, version) — serialize so they don't race each
  // other within this project's run.
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("nav link exists and the list page shows approved entries", async ({
    page,
  }) => {
    await page.goto("/admin");
    await page.getByRole("link", { name: "القاموس" }).click();
    await page.waitForURL(/\/admin\/dictionary$/);
    await expect(
      page.getByRole("heading", { name: "القاموس المعتمد" }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "اتمرمط" }).first(),
    ).toBeVisible();
  });

  test("search filters the table to matching entries only", async ({
    page,
  }) => {
    await page.goto("/admin/dictionary");
    await page.getByLabel("بحث").fill("اتمرمط");
    await page.getByRole("button", { name: "تطبيق الفلاتر" }).click();
    await expect(
      page.getByRole("cell", { name: "اتمرمط" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: "كلمة_نجدية" })).toHaveCount(0);
  });

  test("opens the editor with all fields prefilled from the real row", async ({
    page,
  }, testInfo) => {
    // Other tests in this file mutate this same row's meaning; restrict to
    // desktop (serial) to avoid a cross-project read race on that field.
    test.skip(
      testInfo.project.name !== "desktop",
      "reads a field other tests mutate",
    );

    await page.goto(`/admin/dictionary/${ENTRY_ID}`);
    await expect(
      page.getByRole("heading", { name: "تحرير الكلمة المعتمدة" }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "الكلمة" })).toHaveValue(
      "اتمرمط",
    );
    await expect(page.getByLabel("المفتاح المشتق (تلقائي)")).toHaveValue(
      "اتمرمط",
    );
    await expect(page.getByLabel("المفتاح المشتق (تلقائي)")).toBeDisabled();
    await expect(
      page.getByRole("listitem").filter({ hasText: "عانى" }),
    ).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: "اتبهذل" }),
    ).toBeVisible();
  });

  test("validation blocks saving with no dialect selected, error shown beside the field", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mutating UI state");
    await page.goto(`/admin/dictionary/${ENTRY_ID}`);
    // Uncheck every currently-selected main-group/local-dialect checkbox.
    const checked = page.locator('input[type="checkbox"]:checked');
    const count = await checked.count();
    for (let i = 0; i < count; i++) {
      await checked.nth(0).uncheck();
    }
    await page.getByRole("button", { name: "حفظ ونشر التحديث" }).click();
    await expect(
      page.getByText("اختر لهجة رئيسية واحدة على الأقل."),
    ).toBeVisible();
  });

  test("editing the word, meaning, dialects, and register saves and publishes; export v4 reflects it", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mutates shared entry");

    await page.goto(`/admin/dictionary/${ENTRY_ID}`);
    await page
      .getByLabel("المعنى")
      .fill("تعب وعانى بسبب كثرة العمل والتنقل الطويل");

    // Add a second main dialect group (نجدي) alongside the existing حجازي.
    await page.getByRole("checkbox", { name: "نجدي", exact: true }).check();

    await page.getByRole("button", { name: "حفظ ونشر التحديث" }).click();
    await page.waitForURL(/\/admin\/dictionary$/, { timeout: 15_000 });

    // Real API round trip: v4 export must reflect both dialects and the new meaning.
    const res = await page.request.get(
      "/api/admin/exports?schemaVersion=4&format=json",
    );
    expect(res.ok()).toBe(true);
    const records = (await res.json()) as {
      word: string;
      meaning: string | null;
      dialects: string[];
    }[];
    const record = records.find((r) => r.word === "اتمرمط");
    expect(record).toBeTruthy();
    expect(record!.meaning).toBe("تعب وعانى بسبب كثرة العمل والتنقل الطويل");
    expect(record!.dialects.sort()).toEqual(["hijazi", "najdi"]);
  });

  test("setting visibility to private keeps the word out of the public explorer", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mutates shared entry");
    test.setTimeout(60_000);

    await page.goto(`/admin/dictionary/${ENTRY_ID}`);
    await page.getByLabel("ظهور الكلمة").selectOption("private");
    await page.getByRole("button", { name: "حفظ ونشر التحديث" }).click();
    await page.waitForURL(/\/admin\/dictionary$/, { timeout: 15_000 });

    // /dialects/[slug] uses `revalidate = 30` (ISR); poll rather than
    // assert once so a page cached moments before the save above can't
    // cause a false failure under parallel suite load.
    await expect
      .poll(
        async () => {
          await page.goto("/dialects/hijazi");
          return (await page.getByText("اتمرمط").count()) > 0;
        },
        { timeout: 35_000 },
      )
      .toBe(false);

    // Restore to public so later runs of this spec (and other specs
    // sharing this seeded row) see the expected default state again.
    await page.goto(`/admin/dictionary/${ENTRY_ID}`);
    await page.getByLabel("ظهور الكلمة").selectOption("public");
    await page.getByRole("button", { name: "حفظ ونشر التحديث" }).click();
    await page.waitForURL(/\/admin\/dictionary$/, { timeout: 15_000 });
  });

  test("undo restores the previous meaning after an edit", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mutates shared entry");

    await page.goto(`/admin/dictionary/${ENTRY_ID}`);
    const originalMeaning = await page.getByLabel("المعنى").inputValue();

    await page.getByLabel("المعنى").fill("معنى مؤقت للاختبار سيتم التراجع عنه");
    await page.getByRole("button", { name: "حفظ ونشر التحديث" }).click();
    await page.waitForURL(/\/admin\/dictionary$/, { timeout: 15_000 });

    await page.goto(`/admin/dictionary/${ENTRY_ID}`);
    await expect(page.getByLabel("المعنى")).toHaveValue(
      "معنى مؤقت للاختبار سيتم التراجع عنه",
    );

    await page.getByRole("button", { name: "تراجع عن آخر تعديل" }).click();
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByLabel("المعنى")).toHaveValue(originalMeaning);
  });

  test("undo after changing multiple dialects restores the exact original dialect set, verified via v4 export", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mutates shared entry");

    async function v4Dialects(): Promise<string[]> {
      const res = await page.request.get(
        "/api/admin/exports?schemaVersion=4&format=json",
      );
      const records = (await res.json()) as {
        word: string;
        dialects: string[];
      }[];
      return records.find((r) => r.word === "اتمرمط")!.dialects;
    }

    const before = await v4Dialects();

    await page.goto(`/admin/dictionary/${ENTRY_ID}`);
    await page.getByRole("checkbox", { name: "نجدي", exact: true }).check();
    await page.getByRole("checkbox", { name: "شرقاوي", exact: true }).check();
    await page.getByRole("button", { name: "حفظ ونشر التحديث" }).click();
    await page.waitForURL(/\/admin\/dictionary$/, { timeout: 15_000 });

    const afterEdit = await v4Dialects();
    expect(afterEdit.sort()).not.toEqual([...before].sort());

    // Undo through the real editor UI.
    await page.goto(`/admin/dictionary/${ENTRY_ID}`);
    await page.getByRole("button", { name: "تراجع عن آخر تعديل" }).click();
    await page.waitForTimeout(500);

    const afterUndo = await v4Dialects();
    expect(afterUndo.sort()).toEqual([...before].sort());
  });

  test("undo after adding, removing, editing, and reordering examples restores the exact original list — byte-identical v4 export", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mutates shared entry");

    async function v4Record(): Promise<Record<string, unknown>> {
      const res = await page.request.get(
        "/api/admin/exports?schemaVersion=4&format=json",
      );
      const records = (await res.json()) as { word: string }[];
      return records.find((r) => r.word === "اتمرمط") as Record<
        string,
        unknown
      >;
    }

    const before = await v4Record();

    await page.goto(`/admin/dictionary/${ENTRY_ID}`);
    // Edit the first example's text, remove the second, add a third, then
    // reorder so the added one comes first.
    const examplesList = page.getByTestId("dictionary-examples-list");
    const exampleInputs = examplesList.locator("input");
    await exampleInputs.first().fill("مثال أول معدَّل مؤقتاً");
    await examplesList
      .locator("li")
      .nth(1)
      .getByRole("button", { name: "حذف المثال" })
      .click();
    await page.getByRole("button", { name: "إضافة مثال" }).click();
    await exampleInputs.last().fill("مثال ثالث مضاف مؤقتاً");
    // Move the newly added (last) example to the top.
    await examplesList
      .locator("li")
      .last()
      .getByRole("button", { name: "نقل لأعلى" })
      .click();

    await page.getByRole("button", { name: "حفظ ونشر التحديث" }).click();
    await page.waitForURL(/\/admin\/dictionary$/, { timeout: 15_000 });

    const afterEdit = await v4Record();
    expect(afterEdit).not.toEqual(before);

    await page.goto(`/admin/dictionary/${ENTRY_ID}`);
    await page.getByRole("button", { name: "تراجع عن آخر تعديل" }).click();
    await page.waitForTimeout(500);

    const afterUndo = await v4Record();
    expect(afterUndo).toEqual(before);
    expect(JSON.stringify(afterUndo)).toBe(JSON.stringify(before));
  });

  test("undo restores public visibility so the explorer shows the word again", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mutates shared entry");
    // This test polls the ISR-cached explorer for up to 35s (below) — the
    // default 30s per-test timeout must be raised or the test aborts
    // before its own poll window elapses.
    test.setTimeout(90_000);

    // /dialects/[slug] uses `revalidate = 30` (ISR) — under heavy parallel
    // suite load a request can land on a page generated up to 30s earlier,
    // independent of the DB's current state, so presence/absence checks
    // here poll instead of asserting once.
    async function explorerShowsWord(): Promise<boolean> {
      await page.goto("/dialects/hijazi");
      return (await page.getByText("اتمرمط").count()) > 0;
    }

    await page.goto(`/admin/dictionary/${ENTRY_ID}`);
    const visibilityBefore = await page.getByLabel("ظهور الكلمة").inputValue();
    expect(visibilityBefore).toBe("public");
    await expect.poll(explorerShowsWord, { timeout: 35_000 }).toBe(true);

    await page.goto(`/admin/dictionary/${ENTRY_ID}`);
    await page.getByLabel("ظهور الكلمة").selectOption("private");
    await page.getByRole("button", { name: "حفظ ونشر التحديث" }).click();
    await page.waitForURL(/\/admin\/dictionary$/, { timeout: 15_000 });

    await expect.poll(explorerShowsWord, { timeout: 35_000 }).toBe(false);

    await page.goto(`/admin/dictionary/${ENTRY_ID}`);
    await page.getByRole("button", { name: "تراجع عن آخر تعديل" }).click();
    await page.waitForTimeout(500);

    await page.goto(`/admin/dictionary/${ENTRY_ID}`);
    await expect(page.getByLabel("ظهور الكلمة")).toHaveValue("public");
    await expect.poll(explorerShowsWord, { timeout: 35_000 }).toBe(true);
  });

  test("a stale undo (event already superseded by a newer edit) is rejected with a conflict message", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mutates shared entry");

    await page.goto(`/admin/dictionary/${ENTRY_ID}`);
    await page.getByLabel("المعنى").fill("تعديل أول قبل التراجع القديم");
    await page.getByRole("button", { name: "حفظ ونشر التحديث" }).click();
    await page.waitForURL(/\/admin\/dictionary$/, { timeout: 15_000 });

    // Open the editor (captures the *current* version) but before clicking
    // undo, make a second edit from another session that bumps the version
    // again — the first page's undo click now targets a stale version.
    await page.goto(`/admin/dictionary/${ENTRY_ID}`);

    const secondContext = await page.context().browser()!.newContext();
    const secondPage = await secondContext.newPage();
    await loginAsAdmin(secondPage);
    await secondPage.goto(`/admin/dictionary/${ENTRY_ID}`);
    await secondPage.getByLabel("المعنى").fill("تعديل ثانٍ من مشرف آخر");
    await secondPage.getByRole("button", { name: "حفظ ونشر التحديث" }).click();
    await secondPage.waitForURL(/\/admin\/dictionary$/, { timeout: 15_000 });
    await secondContext.close();

    await page.getByRole("button", { name: "تراجع عن آخر تعديل" }).click();
    await expect(
      page.getByText(/تغيّر هذا الكيان من قبل مشرف آخر/),
    ).toBeVisible({ timeout: 15_000 });

    // Confirm the second admin's edit was NOT clobbered by the stale undo.
    await page.reload();
    await expect(page.getByLabel("المعنى")).toHaveValue(
      "تعديل ثانٍ من مشرف آخر",
    );
  });

  test("a stale save is rejected with a conflict message, not silently overwritten", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mutates shared entry");

    await page.goto(`/admin/dictionary/${ENTRY_ID}`);
    // Simulate a concurrent edit from another admin by bumping the version
    // server-side (via a second edit) while this page keeps its original
    // (now stale) expectedVersion baked into its closures.
    const secondContext = await page.context().browser()!.newContext();
    const secondPage = await secondContext.newPage();
    await loginAsAdmin(secondPage);
    await secondPage.goto(`/admin/dictionary/${ENTRY_ID}`);
    await secondPage.getByLabel("المعنى").fill("تعديل من مشرف آخر");
    await secondPage.getByRole("button", { name: "حفظ ونشر التحديث" }).click();
    await secondPage.waitForURL(/\/admin\/dictionary$/, { timeout: 15_000 });
    await secondContext.close();

    // The first page still holds the pre-edit version; saving now must
    // surface a conflict rather than clobbering the second admin's write.
    await page.getByLabel("المعنى").fill("تعديل من الصفحة الأولى القديمة");
    await page.getByRole("button", { name: "حفظ ونشر التحديث" }).click();
    await expect(
      page.getByText(/تغيّر هذا الكيان من قبل مشرف آخر/),
    ).toBeVisible({ timeout: 15_000 });
  });
});
