import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("household invitation, private image and sharing work between desktop and mobile accounts", async ({
  page,
  browser,
}) => {
  test.setTimeout(45000);
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
  await page
    .getByRole("button", { name: "Households & members", exact: true })
    .first()
    .click();
  await page
    .locator(".household-create")
    .getByLabel("Household name")
    .fill("Gemeinsame Testküche");
  await page
    .getByRole("button", { name: "Create household", exact: true })
    .click();
  await expect(page.locator(".household-members h2")).toHaveText(
    "Gemeinsame Testküche",
  );
  await expect(
    page.getByRole("button", { name: "Leave household", exact: true }),
  ).toBeDisabled();
  await page
    .locator(".household-rename")
    .getByLabel("Household name")
    .fill("Testküche Sharing");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(page.locator(".household-members h2")).toHaveText(
    "Testküche Sharing",
  );
  await page
    .getByLabel("Email address", { exact: true })
    .fill("guest@example.test");
  await page
    .getByRole("combobox", { name: "Role", exact: true })
    .selectOption("EDITOR");
  await page
    .getByRole("button", { name: "Create invitation link", exact: true })
    .click();
  const link = await page
    .getByLabel("Invitation link", { exact: true })
    .inputValue();
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(
    page.getByText("Link selected – please copy it.", { exact: true }),
  ).toBeVisible();

  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const guest = await guestContext.newPage();
  guest.on("pageerror", (e) => errors.push(e.message));
  try {
    await guest.goto(link);
    await expect(
      guest.getByRole("heading", { name: "Du bist eingeladen!" }),
    ).toBeVisible();
    await guest.getByLabel("Dein Name", { exact: true }).fill("Sharing Gast");
    await guest.getByLabel(/^Passwort/).fill("guest-test-password-long");
    await guest
      .getByRole("button", { name: "Konto erstellen & beitreten", exact: true })
      .click();
    await expect(guest.locator(".household-members h2")).toHaveText(
      "Testküche Sharing",
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Households & members", exact: true })
      .first()
      .click();
    await page
      .getByRole("combobox", { name: "Manage household", exact: true })
      .selectOption({ label: "Testküche Sharing" });
    await expect(page.getByLabel("Role: Sharing Gast")).toHaveValue("EDITOR");
    await page
      .getByRole("navigation", { name: "Navigation", exact: true })
      .getByRole("button", { name: "Recipes", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add recipe", exact: true })
      .first()
      .click();
    await page
      .getByLabel("Recipe title", { exact: true })
      .fill("Privater Zitronenkuchen");
    await page
      .getByLabel("Visibility", { exact: true })
      .selectOption("PRIVATE");
    await page.getByLabel("Ingredient 1", { exact: true }).fill("Zitronen");
    await page
      .getByLabel("Instruction 1", { exact: true })
      .fill("Zitronen vorbereiten und backen.");
    await page
      .getByRole("button", { name: "Save recipe", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Privater Zitronenkuchen",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("Add image", { exact: true }).setInputFiles({
      name: "private.png",
      mimeType: "image/png",
      buffer: await readFile("public/icons/192.png"),
    });
    const image = page.locator(".detail-cover img");
    await expect(image).toBeVisible();
    const imageUrl = await image.getAttribute("src");
    expect(
      await guest.evaluate(async (url) => (await fetch(url)).status, imageUrl!),
    ).toBe(404);
    await guest
      .getByRole("navigation", { name: "Mobile Navigation" })
      .getByRole("button", { name: "Rezepte", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", {
        name: "Privater Zitronenkuchen",
        exact: true,
      }),
    ).toHaveCount(0);

    await page
      .getByLabel("Share recipe: Sharing Gast", { exact: true })
      .selectOption("VIEW");
    await page
      .getByRole("button", { name: "Save sharing", exact: true })
      .click();
    await expect(
      page.getByText("Sharing saved.", { exact: true }),
    ).toBeVisible();
    expect(
      await guest.evaluate(async (url) => (await fetch(url)).status, imageUrl!),
    ).toBe(200);
    await guest.reload();
    await guest
      .getByRole("navigation", { name: "Mobile Navigation" })
      .getByRole("button", { name: "Rezepte", exact: true })
      .click();
    await guest
      .getByRole("button", { name: /Privater Zitronenkuchen/ })
      .click();
    await expect(
      guest.getByRole("button", { name: "Bearbeiten", exact: true }),
    ).toHaveCount(0);
    await page
      .getByLabel("Share recipe: Sharing Gast", { exact: true })
      .selectOption("EDIT");
    await page
      .getByRole("button", { name: "Save sharing", exact: true })
      .click();
    await expect(
      page.getByText("Sharing saved.", { exact: true }),
    ).toBeVisible();
    await guest
      .getByRole("button", { name: "Zurück zu den Rezepten", exact: true })
      .click();
    await guest
      .getByRole("button", { name: /Privater Zitronenkuchen/ })
      .click();
    await expect(
      guest.getByRole("button", { name: "Bearbeiten", exact: true }),
    ).toBeVisible();
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await guest.screenshot({
      path: "test-results/sharing-mobile.png",
      fullPage: true,
    });

    await page
      .getByRole("button", { name: "Households & members", exact: true })
      .first()
      .click();
    await page.getByLabel("Role: Sharing Gast").selectOption("VIEWER");
    await expect(page.getByLabel("Role: Sharing Gast")).toHaveValue("VIEWER");
    await guest
      .getByRole("button", { name: "Zurück zu den Rezepten", exact: true })
      .click();
    await guest
      .getByRole("button", { name: /Privater Zitronenkuchen/ })
      .click();
    await expect(
      guest.getByRole("button", { name: "Bearbeiten", exact: true }),
    ).toHaveCount(0);
    page.on("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Remove member: Sharing Gast", exact: true })
      .click();
    await expect(page.getByLabel("Role: Sharing Gast")).toHaveCount(0);
    expect(
      await guest.evaluate(async (url) => (await fetch(url)).status, imageUrl!),
    ).toBe(404);
    expect(errors).toEqual([]);
  } finally {
    await guestContext.close();
  }
});
