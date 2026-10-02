import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("recipe editor, sorting, quantities, images, search and trash work on desktop and mobile", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/");
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe("undefined");
  await page
    .getByLabel("E-Mail-Adresse", { exact: true })
    .fill("browser@example.test");
  await page
    .getByLabel("Passwort", { exact: true })
    .fill("browser-test-password-long");
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  // The account language was saved by the foundation workflow.
  await page
    .getByRole("navigation", { name: "Navigation", exact: true })
    .getByRole("button", { name: "Recipes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add recipe", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Recipe title", { exact: true })).toBeVisible();
  expect(browserErrors).toEqual([]);
  await page
    .getByLabel("Recipe title", { exact: true })
    .fill("Cremiges Pilzrisotto");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Ein Rezept aus dem Browser-Test.");
  await page.getByLabel("Preparation (minutes)", { exact: true }).fill("10");
  await page.getByLabel("Cooking (minutes)", { exact: true }).fill("20");
  await page.getByLabel("Amount 1", { exact: true }).fill("500");
  await page.getByLabel("Ingredient 1", { exact: true }).fill("Pilze");
  await page.getByLabel("Group 1", { exact: true }).fill("Für das Risotto");
  await page
    .getByRole("button", { name: "Add ingredient", exact: true })
    .click();
  await page.getByLabel("Amount 2", { exact: true }).fill("0,1");
  await page.getByLabel("Unit 2", { exact: true }).fill("kg");
  await page.getByLabel("Ingredient 2", { exact: true }).fill("Reis");
  await page.getByLabel("Group 2", { exact: true }).fill("Für das Risotto");
  await page
    .getByRole("button", { name: "Move up ingredient 2", exact: true })
    .click();
  await expect(page.getByLabel("Ingredient 1", { exact: true })).toHaveValue(
    "Reis",
  );
  await page
    .getByLabel("Instruction 1", { exact: true })
    .fill("Pilze vorbereiten.");
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await page.getByLabel("Instruction 2", { exact: true }).fill("Reis garen.");
  await page.getByLabel("Duration (seconds) 2", { exact: true }).fill("1200");
  await page
    .getByLabel("Categories (separate with commas)", { exact: true })
    .fill("Abendessen");
  await page
    .getByLabel("Tags (separate with commas)", { exact: true })
    .fill("Italienisch");
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Cremiges Pilzrisotto", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Servings", { exact: true }).fill("6");
  await expect(
    page.locator(".ingredient-quantity").filter({ hasText: "750 g" }),
  ).toBeVisible();
  await expect(
    page.locator(".ingredient-quantity").filter({ hasText: "0.15 kg" }),
  ).toBeVisible();
  await page
    .getByLabel("Add image", { exact: true })
    .setInputFiles({
      name: "recipe.png",
      mimeType: "image/png",
      buffer: await readFile("public/icons/192.png"),
    });
  await expect(page.locator(".image-gallery img")).toHaveCount(1);
  await expect(page.locator(".detail-cover img")).toBeVisible();
  await page
    .getByRole("button", { name: "Mark as favorite", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove favorite", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "5 stars", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "5 stars", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByLabel("Recipe title", { exact: true })
    .fill("Pilzrisotto mit Reis");
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Pilzrisotto mit Reis", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/recipe-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Back to recipes", exact: true })
    .click();
  await page
    .getByLabel("Search recipes, ingredients or tags", { exact: true })
    .fill("Pilze");
  await expect(
    page.getByRole("heading", { name: "Pilzrisotto mit Reis", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /AbendessenPilzrisotto|Pilzrisotto mit Reis/ })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Pilzrisotto mit Reis", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/recipe-mobile.png",
    fullPage: true,
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Move to trash", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No matching recipes.", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Pilzrisotto mit Reis", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Pilzrisotto mit Reis/ }).click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.getByRole("button", { name: "All recipes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Pilzrisotto mit Reis", exact: true }),
  ).toBeVisible();
  expect(browserErrors).toEqual([]);
});
