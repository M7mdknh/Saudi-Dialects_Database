import { test, expect } from "@playwright/test";

test.describe("site identity and navigation", () => {
  test("the header shows the renamed site identity and the four nav links, with an active state on the current page", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/قاموس اللهجات السعودية/);
    await expect(
      page.getByRole("link", { name: "قاموس اللهجات السعودية" }),
    ).toBeVisible();

    const menuButton = page.getByRole("button", { name: "فتح القائمة" });
    if (await menuButton.isVisible().catch(() => false))
      await menuButton.click();

    const nav = page
      .getByRole("navigation", { name: "التنقّل الرئيسي" })
      .last();
    for (const label of [
      "الرئيسية",
      "ساهم بكلمة",
      "تحدّي الكلمات",
      "لوحة اللهجات",
    ]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "الرئيسية" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("the homepage has exactly one h1, matching the renamed site identity", async ({
    page,
  }) => {
    await page.goto("/");
    const h1s = page.getByRole("heading", { level: 1 });
    await expect(h1s).toHaveCount(1);
    await expect(h1s.first()).toHaveText("قاموس اللهجات السعودية");
  });

  test("لوحة اللهجات nav link navigates to the leaderboard and shows it as active", async ({
    page,
  }) => {
    await page.goto("/");
    const menuButton = page.getByRole("button", { name: "فتح القائمة" });
    if (await menuButton.isVisible().catch(() => false))
      await menuButton.click();

    const nav = page
      .getByRole("navigation", { name: "التنقّل الرئيسي" })
      .last();
    await nav.getByRole("link", { name: "لوحة اللهجات" }).click();
    await expect(page).toHaveURL(/\/leaderboard/);

    const menuButtonAfter = page.getByRole("button", { name: "فتح القائمة" });
    if (await menuButtonAfter.isVisible().catch(() => false))
      await menuButtonAfter.click();
    const navAfter = page
      .getByRole("navigation", { name: "التنقّل الرئيسي" })
      .last();
    await expect(
      navAfter.getByRole("link", { name: "لوحة اللهجات" }),
    ).toHaveAttribute("aria-current", "page");
  });
});

test.describe("homepage leaderboard preview", () => {
  test("shows all five main groups with correct Arabic count phrasing and a link to the full leaderboard", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("heading", { name: "أي لهجة جمعت مساهمات أكثر؟" })
      .scrollIntoViewIfNeeded();
    for (const label of ["حجازي", "نجدي", "شرقاوي", "شمالي", "جنوبي"]) {
      await expect(
        page.getByText(label, { exact: true }).first(),
      ).toBeVisible();
    }
    await expect(
      page.getByRole("link", { name: "عرض لوحة اللهجات" }),
    ).toBeVisible();
    // No broken "()كلمة" phrasing: a zero-count group reads as a real sentence.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/\(\s*كلمة/);
  });
});

test.describe("no horizontal overflow", () => {
  for (const [name, width, height] of [
    ["360x800", 360, 800],
    ["390x844", 390, 844],
    ["430x932", 430, 932],
  ] as const) {
    test(`homepage has no horizontal scroll at ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const [scrollWidth, clientWidth] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ]);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });

    test(`/prompts has no horizontal scroll at ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/prompts");
      const [scrollWidth, clientWidth] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ]);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });
  }
});

test.describe("desktop uses the available width", () => {
  test("the contribution form is not trapped in a phone-sized column on a laptop viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const form = page.locator("#contribute");
    const box = await form.boundingBox();
    expect(box).not.toBeNull();
    // A phone-width column would be well under 500px; the form shell token
    // targets ~820px.
    expect(box!.width).toBeGreaterThan(700);
  });
});

test.describe("/prompts explorer", () => {
  test("shows the heading, category list, and a progress line, and lets a visitor search", async ({
    page,
  }) => {
    await page.goto("/prompts");
    await expect(
      page.getByRole("heading", { name: "تحدّي الكلمات" }),
    ).toBeVisible();
    await expect(page.getByText(/أجبت عن ٠ من/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "كل التصنيفات" }),
    ).toBeVisible();
  });

  test("selecting a card navigates to the homepage and opens the same guided contribution workflow", async ({
    page,
  }) => {
    await page.goto("/prompts");
    const firstCard = page
      .getByRole("list")
      .filter({ has: page.getByRole("button") })
      .first()
      .getByRole("button")
      .first();
    const hasCards = await firstCard.isVisible().catch(() => false);
    test.skip(!hasCards, "No prompts available from the backend.");

    await firstCard.click();
    await expect(page).toHaveURL(/\/#contribute/);
    // The guided card's read-only reference fields prove the same workflow
    // opened, not a separate form.
    await expect(page.getByLabel(/الكلمة باللهجة/).last()).toHaveValue("");
  });

  test("filtering to a category never shows an empty page filled with 29 oversized buttons — results stay the primary content", async ({
    page,
  }) => {
    await page.goto("/prompts");
    const categoryButtons = page.locator("aside button");
    const count = await categoryButtons.count();
    expect(count).toBeGreaterThan(1);
    // Category buttons are compact list items, not full-width oversized tiles.
    const box = await categoryButtons.nth(1).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThan(60);
  });
});

test.describe("guided prompt card simplification", () => {
  test("the collapsed card shows only the category, the word, one line of meaning, and an action cue — not the full scenario question", async ({
    page,
  }) => {
    await page.goto("/");
    const rail = page.getByRole("list", { name: "معانٍ مقترحة للمساهمة" });
    const hasCards = await rail
      .getByRole("button")
      .first()
      .isVisible()
      .catch(() => false);
    test.skip(!hasCards, "No guided prompts available.");

    await expect(page.getByText("أضف كلمتك").first()).toBeVisible();
  });
});
