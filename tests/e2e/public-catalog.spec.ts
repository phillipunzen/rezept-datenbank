import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { emptyRecipe } from "../../shared/recipes";
test("creator publishes explicitly and anonymous visitors discover recipes without source information", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Rezepte entdecken", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("E-Mail-Adresse", { exact: true })
    .fill("browser@example.test");
  await page
    .getByLabel("Passwort", { exact: true })
    .fill("browser-test-password-long");
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your recipes", exact: true }),
  ).toBeVisible();
  const householdId = await page.evaluate(
    async () =>
      (await (await fetch("/api/v1/households")).json()).households[0].household
        .id,
  );
  const draft = {
    ...emptyRecipe(householdId),
    title: "Öffentliche Zitronenpasta",
    description: "Frische Inspiration für den öffentlichen Katalog.",
    source: "Browser source sentinel",
    sourceUrl: "https://browser-source.example.test/recipe",
    notes: "Browser private sentinel",
    tags: ["Sommerküche"],
    visibility: "PRIVATE" as const,
    ingredients: [
      { name: "Nudeln", amount: "200", unit: "g", group: "", note: "" },
    ],
    steps: [
      {
        instruction: "Nudeln kochen und mit Zitrone mischen.",
        durationSeconds: 600,
        ingredientIndexes: [0],
      },
    ],
  };
  const recipe = await page.evaluate(async (draft) => {
    const r = await fetch("/api/v1/recipes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!r.ok) throw Error(await r.text());
    return (await r.json()).recipe;
  }, draft);
  await page.reload();
  await page.getByRole("button", { name: /Öffentliche Zitronenpasta/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Öffentliche Zitronenpasta",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Add image", { exact: true }).setInputFiles({
    name: "recipe.png",
    mimeType: "image/png",
    buffer: await readFile("public/icons/192.png"),
  });
  await expect(page.locator(".image-gallery img")).toHaveCount(1);
  const anonymous = await browser.newContext(),
    visitor = await anonymous.newPage();
  visitor.on("pageerror", (e) => errors.push(e.message));
  await visitor.goto("/entdecken?q=Öffentliche+Zitronenpasta");
  await expect(
    visitor.getByText("Keine passenden Rezepte gefunden.", { exact: true }),
  ).toBeVisible();
  page.on("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Publish publicly", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Open public recipe", exact: true }),
  ).toBeVisible();
  await visitor.goto("/");
  await visitor
    .getByRole("link", { name: "Rezepte entdecken", exact: true })
    .click();
  await visitor
    .getByLabel("Rezepte suchen", { exact: true })
    .fill("Sommerküche");
  await visitor.getByRole("button", { name: "Suchen", exact: true }).click();
  await expect(visitor.locator(".catalog-card")).toHaveCount(1);
  expect(
    await visitor.locator(".catalog-card").evaluate((card) => {
      const image = card.querySelector("img")!.getBoundingClientRect(),
        body = card
          .querySelector(".catalog-card-body")!
          .getBoundingClientRect();
      return image.bottom <= body.top + 1;
    }),
  ).toBe(true);
  await visitor.screenshot({
    path: "test-results/public-catalog-desktop.png",
    fullPage: true,
  });
  await visitor.locator(".catalog-card").click();
  await expect(
    visitor.getByRole("heading", { name: recipe.title, exact: true }),
  ).toBeVisible();
  await expect(
    visitor.getByText("Nudeln kochen und mit Zitrone mischen.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(visitor.locator(".detail-cover img")).toBeVisible();
  const imageUrl = await visitor
    .locator(".detail-cover img")
    .getAttribute("src");
  expect(
    await visitor.evaluate(async (url) => (await fetch(url!)).status, imageUrl),
  ).toBe(200);
  const html = await visitor.content();
  for (const text of [draft.source, draft.sourceUrl, draft.notes, householdId])
    expect(html).not.toContain(text);
  expect(
    await visitor.evaluate(async () => {
      const r = await fetch(
        "/api/v1/catalog/recipes/" + location.pathname.split("/").pop(),
      );
      return Object.keys((await r.json()).recipe);
    }),
  ).not.toContain("source");
  await visitor.setViewportSize({ width: 390, height: 844 });
  expect(
    await visitor.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await visitor.screenshot({
    path: "test-results/public-detail-mobile.png",
    fullPage: true,
  });
  await visitor.goto("/entdecken?q=Sommerküche");
  expect(
    await visitor.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await visitor.emulateMedia({ colorScheme: "dark" });
  await visitor.reload();
  await expect(visitor.locator("html")).toHaveAttribute("data-theme", "dark");
  await visitor.screenshot({
    path: "test-results/public-catalog-dark-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Withdraw publication", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Publish publicly", exact: true }),
  ).toBeVisible();
  await visitor.reload();
  await expect(visitor.locator(".catalog-card")).toHaveCount(0);
  expect(
    await visitor.evaluate(async (url) => (await fetch(url!)).status, imageUrl),
  ).toBe(404);
  const response = await visitor.goto("/entdecken/" + recipe.id);
  expect(response?.status()).toBe(404);
  expect(await anonymous.cookies()).toEqual([]);
  expect(errors).toEqual([]);
  await anonymous.close();
});
