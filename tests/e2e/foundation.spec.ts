import { test, expect } from "@playwright/test";
import { config } from "dotenv";
config({ path: ".env.e2e", quiet: true });
test("first admin setup, dashboard, settings, language, logout and mobile login", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Richten wir deine Küche ein." }),
  ).toBeVisible();
  await page
    .getByLabel("Einrichtungscode", { exact: true })
    .fill(process.env.INITIAL_SETUP_TOKEN!);
  await page.getByLabel("Name", { exact: true }).fill("Browser Admin");
  await page
    .getByLabel("E-Mail-Adresse", { exact: true })
    .fill("browser@example.test");
  await page
    .getByLabel("Passwort", { exact: true })
    .fill("browser-test-password-long");
  await page
    .getByLabel("Name des Haushalts", { exact: true })
    .fill("Browser Zuhause");
  await page
    .getByRole("button", { name: "Küche einrichten", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Deine Rezepte", exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Navigation", exact: true })
    .getByRole("button", { name: "Übersicht", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /Schön, dass du da bist/ }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Einstellungen", exact: true })
    .first()
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Phillip");
  await page.getByLabel("Sprache", { exact: true }).selectOption("en");
  await page
    .getByRole("button", { name: "Änderungen speichern", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome to your kitchen." }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByLabel("Email address", { exact: true })
    .fill("browser@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-password-long");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your recipes", exact: true }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/dashboard-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "Mobile Navigation" })
    .getByRole("button", { name: "Recipes", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your recipes", exact: true }),
  ).toBeVisible();
});
