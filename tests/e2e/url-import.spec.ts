import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { emptyRecipe } from "../../shared/recipes";

test("website import previews editable fields and stores its image with the recipe", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const image = await sharp({
    create: { width: 120, height: 80, channels: 3, background: "orange" },
  })
    .webp()
    .toBuffer();
  let failUpload = true;
  await page.route("**/api/v1/recipes/*/images?revision=*", async (route) => {
    if (route.request().method() === "POST" && failUpload) {
      failUpload = false;
      return route.fulfill({
        status: 503,
        json: { message: "Temporärer Uploadfehler" },
      });
    }
    return route.continue();
  });
  // Extraction and safe network fetching are verified separately; keep the UI test independent of a publisher's uptime.
  await page.route("**/api/v1/recipe-imports/preview", async (route) => {
    const body = route.request().postDataJSON();
    if (body.url.endsWith("/missing"))
      return route.fulfill({
        status: 422,
        json: {
          message:
            "Auf dieser Seite wurden keine lesbaren Rezeptdaten gefunden.",
        },
      });
    expect(body.url).toBe("https://recipes.example.test/suppe");
    return route.fulfill({
      json: {
        draft: {
          ...emptyRecipe(body.householdId),
          title: "Importierte Suppe",
          description: "Aus einer anderen Küche.",
          source: "recipes.example.test",
          sourceUrl: body.url,
          servings: 2,
          cookMinutes: 15,
          ingredients: [
            { name: "Karotten", amount: "250", unit: "g", group: "", note: "" },
          ],
          steps: [{ instruction: "Karotten kochen.", durationSeconds: null }],
          tags: ["Suppe"],
        },
        imageDataUrl: `data:image/webp;base64,${image.toString("base64")}`,
        warnings: [],
      },
    });
  });
  await page.goto("/");
  await page
    .getByLabel("E-Mail-Adresse", { exact: true })
    .fill("browser@example.test");
  await page
    .getByLabel("Passwort", { exact: true })
    .fill("browser-test-password-long");
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Navigation", exact: true })
    .getByRole("button", { name: "Recipes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add recipe", exact: true })
    .first()
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByLabel("Recipe link", { exact: true })
    .fill("https://recipes.example.test/missing");
  await page
    .getByRole("button", { name: "Import recipe", exact: true })
    .click();
  await expect(page.locator('.error-box[role="alert"]')).toContainText(
    "keine lesbaren Rezeptdaten",
  );
  await expect(page.getByLabel("Recipe title", { exact: true })).toHaveValue(
    "",
  );
  await page
    .getByLabel("Recipe link", { exact: true })
    .fill("https://recipes.example.test/suppe");
  await page
    .getByRole("button", { name: "Import recipe", exact: true })
    .click();
  await expect(page.getByLabel("Recipe title", { exact: true })).toHaveValue(
    "Importierte Suppe",
  );
  await expect(page.getByLabel("Ingredient 1", { exact: true })).toHaveValue(
    "Karotten",
  );
  await expect(
    page.getByAltText("Imported recipe image", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/url-import-mobile.png",
    fullPage: true,
  });
  await page
    .getByLabel("Recipe title", { exact: true })
    .fill("Meine importierte Suppe");
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Meine importierte Suppe", exact: true }),
  ).toBeVisible();
  await expect(page.locator('.error-box[role="alert"]')).toContainText(
    "The recipe was saved",
  );
  await page
    .getByRole("button", { name: "Retry saving image", exact: true })
    .click();
  await expect(page.locator(".image-gallery img")).toHaveCount(1);
  await expect(page.locator('.error-box[role="alert"]')).toHaveCount(0);
  const src = await page.locator(".detail-cover img").getAttribute("src");
  expect(src).toMatch(/^\/api\/v1\/recipes\/[^/]+\/images\//);
  await expect(page.locator(".detail-cover img")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /recipes.example.test/ }),
  ).toHaveAttribute("href", "https://recipes.example.test/suppe");
  expect(errors).toEqual([]);
});
