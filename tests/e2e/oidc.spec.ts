import { test, expect } from "@playwright/test";

test("OIDC callback failures remain visible and Authentik branding works on mobile and dark mode", async ({ page }) => {
  await page.route("**/api/v1/auth/options", (route) => route.fulfill({
    json: { passwordResetEnabled: false, oidcEnabled: true, oidcLabel: "Anmelden mit Authentik" },
  }));
  // A delayed startup request reproduced the error being cleared by load().
  await page.route("**/api/v1/system", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.continue();
  });
  await page.goto("/#authError=registration_disabled");
  await expect(page.locator(".auth-card").getByRole("alert")).toContainText("Kontoerstellung über SSO ist deaktiviert");
  await expect(page).not.toHaveURL(/authError/);
  const signin = page.getByRole("button", { name: "Anmelden mit Authentik", exact: true });
  await expect(signin).toBeVisible();
  const logo = signin.locator("img");
  await expect(logo).toHaveAttribute("src", "/brands/authentik.svg");
  expect(await logo.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
  await expect(signin).toHaveCSS("background-color", "rgb(253, 75, 45)");
  await page.getByLabel("Sprache", { exact: true }).selectOption("en");
  await expect(page.locator(".auth-card").getByRole("alert")).toContainText("Creating accounts through SSO is disabled");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/authentik-mobile.png", fullPage: true });

  // Existing generic providers retain their own label and standard button.
  await page.unroute("**/api/v1/auth/options");
  await page.route("**/api/v1/auth/options", (route) => route.fulfill({
    json: { passwordResetEnabled: false, oidcEnabled: true, oidcLabel: "Company SSO" },
  }));
  await page.goto("about:blank");
  await page.goto("http://rezeptdatenbank.test:8081/#authError=email_unverified");
  await expect(page.locator(".auth-card").getByRole("alert")).toContainText("bestätigte E-Mail-Adresse");
  await expect(page.getByRole("button", { name: "Company SSO" })).toBeVisible();
  await expect(page.locator(".authentik-mark")).toHaveCount(0);
});
