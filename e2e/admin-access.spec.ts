import { test, expect } from "@playwright/test";

test.describe("admin access control", () => {
  test("visiting the dashboard without a session redirects to login", async ({
    page,
  }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(
      page.getByRole("heading", { name: "تسجيل دخول المشرفين" }),
    ).toBeVisible();
  });

  test("the login form rejects invalid credentials with an Arabic error", async ({
    page,
  }) => {
    await page.goto("/admin/login");
    await page.getByLabel("البريد الإلكتروني").fill("nobody@example.com");
    await page.getByLabel("كلمة المرور").fill("wrong-password");
    await page.getByRole("button", { name: "دخول" }).click();
    await expect(page.getByText(/تعذّر تسجيل الدخول/)).toBeVisible();
  });
});
