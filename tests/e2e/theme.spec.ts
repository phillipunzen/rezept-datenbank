import { test, expect } from "@playwright/test";

test("Studio follows browser appearance, persists manual choices and works on mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: "dark" });
  // The old app wrote this derived value automatically; it must not override System.
  await page.addInitScript(() => localStorage.setItem("recipe-theme", "light"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByLabel("E-Mail-Adresse", { exact: true })
    .fill("browser@example.test");
  await page
    .getByLabel("Passwort", { exact: true })
    .fill("browser-test-password-long");
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  const picker = page
    .locator(".topbar")
    .getByLabel("Appearance", { exact: true });
  await expect(picker).toHaveValue("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await picker.selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(picker).toHaveValue("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await picker.selectOption("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  await expect(
    page
      .locator(".appearance-settings")
      .getByLabel("Appearance", { exact: true }),
  ).toHaveValue("dark");
  await page.screenshot({
    path: "test-results/studio-settings-dark.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "Navigation", exact: true })
    .getByRole("button", { name: "Recipes", exact: true })
    .click();
  await picker.selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator(".real-recipe-card").first()).toBeVisible();
  await page.screenshot({
    path: "test-results/studio-collection-light.png",
    fullPage: true,
  });

  const tab = await page.context().newPage();
  try {
    await tab.goto("/");
    await expect(tab.locator("html")).toHaveAttribute("data-theme", "light");
    await picker.selectOption("dark");
    await expect(tab.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(
      tab.locator(".topbar").getByLabel("Appearance", { exact: true }),
    ).toHaveValue("dark");
  } finally {
    await tab.close();
  }
  await picker.selectOption("system");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/studio-collection-mobile-dark.png",
    fullPage: true,
  });
  const card = page.locator(".real-recipe-card").first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator(".recipe-detail-view")).toBeVisible();
  await expect(page.locator(".recipe-library")).toBeHidden();
  await page.setViewportSize({ width: 1360, height: 900 });
  await expect(page.locator(".recipe-library")).toBeHidden();
  await expect(page.locator(".recipe-detail-view")).toBeVisible();
  const workspace = await page.locator(".recipe-workspace").boundingBox();
  const detail = await page.locator(".recipe-detail-view").boundingBox();
  expect(detail!.width).toBeCloseTo(workspace!.width, 0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/studio-recipe-fullpage-dark.png",
    fullPage: true,
  });
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".recipe-library")).toBeHidden();
  await expect(page.locator(".recipe-detail-view")).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await page
    .getByRole("button", { name: "Back to recipes", exact: true })
    .click();
  await expect(page.locator(".recipe-library")).toBeVisible();
  await expect(page.locator(".recipe-detail-view")).toBeHidden();
  expect(errors).toEqual([]);
});

test("browser theme still works when storage is unavailable", async ({
  browser,
}) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  await context.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage disabled");
      },
    });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto("http://rezeptdatenbank.test:8081/");
    await expect(
      page.getByRole("heading", { name: "Willkommen in deiner Küche." }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
