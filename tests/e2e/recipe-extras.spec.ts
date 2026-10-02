import { test, expect } from "@playwright/test";
import { emptyRecipe } from "../../shared/recipes";
import { testZip, tandoorFixture } from "../helpers/zip";
test("confirmed device settings, public revocation, portable JSON and large Tandoor archive", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
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
  const recipe = await page.evaluate(
    async (draft) => {
      const hh = (await (await fetch("/api/v1/households")).json())
        .households[0].household.id;
      const res = await fetch("/api/v1/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, householdId: hh }),
      });
      if (!res.ok) throw Error(await res.text());
      return (await res.json()).recipe;
    },
    {
      ...emptyRecipe(""),
      title: "Extras test meal",
      notes: "SECRET PERSONAL NOTE",
      ingredients: [
        { name: "Kartoffeln", amount: "500", unit: "g", group: "", note: "" },
      ],
      steps: [
        {
          instruction: "Mix potatoes",
          durationSeconds: 10,
          ingredientIndexes: [0],
        },
      ],
      allergens: ["Milk"],
      nutrition: {
        calories: "350",
        carbohydrates: null,
        fats: null,
        proteins: null,
        basis: "SERVING",
        source: "Test",
      },
    },
  );
  await page.reload();
  await page.getByRole("button", { name: /Extras test meal/ }).click();
  await expect(
    page.getByRole("heading", { name: recipe.title, exact: true, level: 1 }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Prepare for Thermomix", exact: true })
    .click();
  const device = page.locator(".recipe-device-editor");
  await device.getByLabel("Prepare on Thermomix", { exact: true }).check();
  await device.getByLabel("Speed", { exact: true }).fill("5");
  await device
    .getByLabel("I reviewed and confirm all device settings.", { exact: true })
    .check();
  await device
    .getByRole("button", { name: "Save confirmed settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Thermomix cooking", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Thermomix cooking", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Mix potatoes");
  await expect(page.getByRole("dialog")).toContainText("5");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close cooking mode", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Manage public links", exact: true })
    .click();
  await page
    .getByLabel("I want to share this recipe publicly.", { exact: true })
    .check();
  await page.getByRole("button", { name: "Create link", exact: true }).click();
  const link = page.getByLabel("Share link (copy now)", { exact: true });
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  const anon = await browser.newContext();
  const publicPage = await anon.newPage();
  await publicPage.goto(url);
  await expect(
    publicPage.getByRole("heading", {
      name: recipe.title,
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  expect(await publicPage.content()).not.toContain("SECRET PERSONAL NOTE");
  expect(
    await publicPage
      .locator('script[type="application/ld+json"]')
      .textContent(),
  ).toContain("Recipe");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(page.locator(".recipe-public-sharing")).toContainText("Revoked");
  expect((await publicPage.reload())?.status()).toBe(404);
  await anon.close();
  const document = await page.evaluate(
    async (id) => await (await fetch(`/api/v1/recipes/${id}/export`)).json(),
    recipe.id,
  );
  const nav = page.getByRole("navigation", { name: "Navigation", exact: true });
  await nav.getByRole("button", { name: "Import", exact: true }).click();
  await page
    .getByLabel("Choose recipe file (max. 24 MiB)", { exact: true })
    .setInputFiles({
      name: "meal.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(document)),
    });
  await expect(page.locator(".import-grid h3")).toHaveText(recipe.title);
  await page
    .getByLabel("Included device settings reviewed and confirmed.", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Import recipe", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: recipe.title, exact: true, level: 1 }),
  ).toBeVisible();
  await nav.getByRole("button", { name: "Import", exact: true }).click();
  // Exceeds Next's previous 10 MiB proxy limit while staying inside upload/entry limits.
  const archive = testZip({
    "1.zip": testZip({
      "recipe.json": JSON.stringify({
        ...tandoorFixture,
        name: "Browser Tandoor meal",
      }),
    }),
    "2.zip": testZip({ "recipe.json": "{broken" }),
    "ignored.txt": Buffer.alloc(11 * 1024 * 1024, 65),
  });
  await page
    .getByLabel("Choose ZIP (max. 64 MiB, 1000 recipes)", { exact: true })
    .setInputFiles({
      name: "tandoor.zip",
      mimeType: "application/zip",
      buffer: archive,
    });
  await expect(page.locator(".import-job")).toContainText("2 recipes", {
    timeout: 15000,
  });
  await page
    .locator(".import-job")
    .getByRole("button", { name: "Start import", exact: true })
    .click();
  await expect(page.locator(".import-job").getByRole("status")).toContainText(
    "Completed",
    { timeout: 20000 },
  );
  await expect(page.locator(".import-job").getByRole("status")).toContainText(
    "1 imported",
  );
  await expect(page.locator(".import-job").getByRole("status")).toContainText(
    "1 failed",
  );
  await page
    .locator(".import-job")
    .getByRole("button", { name: "Open recipe", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Browser Tandoor meal", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/recipe-extras-mobile.png",
    fullPage: true,
  });
  await page.evaluate(async () => {
    const hh = (await (await fetch("/api/v1/households")).json()).households[0]
      .household.id;
    const { recipes } = await (
      await fetch(`/api/v1/recipes?householdId=${hh}`)
    ).json();
    for (const r of recipes.filter((r: { title: string }) =>
      ["Extras test meal", "Browser Tandoor meal"].includes(r.title),
    ))
      await fetch(`/api/v1/recipes/${r.id}?revision=${r.revision}`, {
        method: "DELETE",
      });
  });
  expect(errors).toEqual([]);
});
