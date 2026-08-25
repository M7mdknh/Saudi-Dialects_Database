import { test, expect } from "@playwright/test";

// These journeys exercise the real guided-prompt backend
// (list_reference_prompts_page, submit_batch) rather than mocking fetch, so
// they only produce meaningful results when NEXT_PUBLIC_SUPABASE_URL points
// at a live (or locally proxied) Supabase-compatible backend with the
// reference_prompts seed applied. If prompts aren't available, the guided
// rail degrades to its empty state and these tests are skipped instead of
// failing spuriously.

function guidedCards(page: import("@playwright/test").Page) {
  return page
    .getByRole("list", { name: "معانٍ مقترحة للمساهمة" })
    .getByRole("button");
}

test.describe("guided contribution journey", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("choosing a suggested meaning prefills the reference fields as read-only and lets the visitor add the dialect word", async ({
    page,
  }) => {
    const chooseButton = guidedCards(page).first();
    const hasPrompts = await chooseButton.isVisible().catch(() => false);
    test.skip(
      !hasPrompts,
      "No guided prompts available from the backend in this environment.",
    );

    const promptWord = await chooseButton
      .locator("p.text-lg")
      .first()
      .textContent();

    await chooseButton.click();

    // The newly added card's synonym is now read-only text showing the
    // chosen prompt's msa_lemma, not an editable input.
    await expect(
      page.getByText(promptWord!.trim(), { exact: true }).last(),
    ).toBeVisible();

    const wordInputs = page.getByLabel(/الكلمة باللهجة/);
    const guidedWordInput = wordInputs.last();
    await expect(guidedWordInput).toHaveValue("");
    await guidedWordInput.fill("كلمة الاختبار الموجّه");

    const dialectInputs = page.getByLabel(/اللهجة أو المنطقة/);
    await dialectInputs.last().fill("جداوي");

    const exampleInputs = page.getByLabel("مثال في جملة");
    await exampleInputs.last().fill("هذه جملة اختبار للكلمة الموجّهة");
  });

  test("a guided submission succeeds and the success screen is shown", async ({
    page,
  }) => {
    const chooseButton = guidedCards(page).first();
    const hasPrompts = await chooseButton.isVisible().catch(() => false);
    test.skip(
      !hasPrompts,
      "No guided prompts available from the backend in this environment.",
    );

    await chooseButton.click();

    // Remove the leftover empty ordinary card so only the guided card needs filling.
    const removeButtons = page.getByRole("button", { name: /حذف الكلمة/ });
    if ((await removeButtons.count()) > 1) {
      await removeButtons.first().click();
    }

    await page
      .getByLabel(/الكلمة باللهجة/)
      .first()
      .fill("عيش موجّه");
    await page
      .getByLabel(/اللهجة أو المنطقة/)
      .first()
      .fill("جداوي");
    await page
      .getByLabel("مثال في جملة")
      .first()
      .fill("جبت العيش الموجّه من الفرن");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "إرسال المساهمة" }).click();

    await expect(
      page.getByRole("heading", { name: "وصلتنا مساهمتك، شكرًا لك!" }),
    ).toBeVisible({
      timeout: 15000,
    });
    await expect(
      page.getByRole("button", { name: "ساهم بكلمة أخرى" }),
    ).toBeVisible();
  });

  test("ordinary contribution keeps working alongside the guided prompts rail", async ({
    page,
  }) => {
    await page
      .getByLabel(/الكلمة باللهجة/)
      .first()
      .fill("كلمة عادية");
    await page
      .getByLabel(/اللهجة أو المنطقة/)
      .first()
      .fill("نجدي");
    await page
      .getByLabel(/المرادف بالعربية الفصحى/)
      .first()
      .fill("مرادف");
    await page
      .getByLabel("مثال في جملة")
      .first()
      .fill("مثال عادي بلا معنى موجّه");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "إرسال المساهمة" }).click();

    await expect(
      page.getByRole("heading", { name: "وصلتنا مساهمتك، شكرًا لك!" }),
    ).toBeVisible({
      timeout: 15000,
    });
  });

  test("keyboard: the guided card and the submit button are both reachable and operable by keyboard", async ({
    page,
  }) => {
    const chooseButton = guidedCards(page).first();
    const hasPrompts = await chooseButton.isVisible().catch(() => false);
    test.skip(
      !hasPrompts,
      "No guided prompts available from the backend in this environment.",
    );

    await chooseButton.focus();
    await expect(chooseButton).toBeFocused();
    await page.keyboard.press("Enter");

    const wordInputs = page.getByLabel(/الكلمة باللهجة/);
    await expect(wordInputs.last()).toHaveValue("");

    // The submit button is legitimately disabled (and therefore unfocusable)
    // until consent is given — check it first, matching real usage.
    await page.getByRole("checkbox").check();
    const submit = page.getByRole("button", { name: "إرسال المساهمة" });
    await expect(submit).toBeEnabled();
    await submit.focus();
    await expect(submit).toBeFocused();
  });
});
