import { test, expect } from "@playwright/test";

test.describe("public contribution journey", () => {
  test("a mobile visitor submits two words with examples and sees confirmation", async ({
    page,
  }) => {
    await page.route("**/api/submissions", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          batchId: "11111111-1111-1111-1111-111111111111",
        }),
      });
    });

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "ساهم بكلمة من لهجتك" }),
    ).toBeVisible();

    await page
      .getByLabel(/الكلمة باللهجة/)
      .first()
      .fill("سبهللة");
    await page
      .getByLabel(/اللهجة أو المنطقة/)
      .first()
      .fill("حجازي");
    await page
      .getByLabel(/مرادفها بالعربية الفصحى/)
      .first()
      .fill("بلا هدف");
    await page.getByLabel("مثال في جملة").first().fill("راح يمشي سبهللة");

    await page.getByRole("button", { name: "+ إضافة كلمة أخرى" }).click();
    await page
      .getByLabel(/الكلمة باللهجة/)
      .nth(1)
      .fill("زول");
    await page
      .getByLabel(/اللهجة أو المنطقة/)
      .nth(1)
      .fill("سوداني");
    await page
      .getByLabel(/مرادفها بالعربية الفصحى/)
      .nth(1)
      .fill("شخص");
    await page.getByLabel("مثال في جملة").nth(1).fill("الزول ده طيب");
    await page.getByRole("button", { name: "+ إضافة مثال" }).nth(1).click();
    await page
      .getByLabel(/مثال إضافي/)
      .first()
      .fill("زول غريب");

    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "إرسال المساهمة" }).click();

    await expect(
      page.getByRole("heading", { name: "وصلتنا مساهمتك، وشكراً لك!" }),
    ).toBeVisible();
  });

  test("a contributor reloads before submitting and recovers the draft", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByLabel(/الكلمة باللهجة/)
      .first()
      .fill("مسودة اختبار");
    await page.reload();

    await expect(page.getByText(/تمت استعادة مسودة محفوظة/)).toBeVisible();
    await expect(page.getByLabel(/الكلمة باللهجة/).first()).toHaveValue(
      "مسودة اختبار",
    );
  });

  test("submitting with missing required fields keeps the page usable and shows errors", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByLabel(/الكلمة باللهجة/)
      .first()
      .fill("كلمة بلا مثال");
    await page
      .getByLabel(/اللهجة أو المنطقة/)
      .first()
      .fill("حجازي");
    await page
      .getByLabel(/مرادفها بالعربية الفصحى/)
      .first()
      .fill("مرادف");
    await page.getByRole("checkbox").check();

    const submit = page.getByRole("button", { name: "إرسال المساهمة" });
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByText("أدخل مثالاً أو احذف هذا الحقل")).toBeVisible();
  });
});
