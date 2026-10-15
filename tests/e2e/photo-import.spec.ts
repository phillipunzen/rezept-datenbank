import { test, expect } from "@playwright/test";
import { emptyRecipe } from "../../shared/recipes";
import type { ChatgptStatus } from "../../shared/chatgpt";

test("photo import requires connection and zero-credit confirmation, then opens an editable private preview on phone and tablet", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  const status: ChatgptStatus = { enabled: true, secureOrigin: true, creditsDisabledConfirmed: true, accounts: [] };
  let photoCalls = 0, creates = 0;
  await page.route("**/api/v1/chatgpt", route => route.fulfill({ json: status }));
  await page.route("**/api/v1/chatgpt/pairing", route => route.fulfill({ json: { code: "a".repeat(64), expiresAt: new Date(Date.now() + 600000).toISOString() } }));
  await page.route("**/api/v1/chatgpt/accounts/account/credits", route => {
    expect(route.request().postDataJSON()).toEqual({ confirmedZeroCredits: true });
    status.accounts[0].creditsConfirmed = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/v1/chatgpt/models", route => route.fulfill({ json: { models: [{ slug: "vision-test", displayName: "Test vision" }] } }));
  await page.route("**/api/v1/recipe-imports/photo/preview?**", route => {
    photoCalls++;
    const query = new URL(route.request().url()).searchParams;
    expect(query.get("consent")).toBe("true"); expect(query.get("model")).toBe("vision-test");
    const draft = { ...emptyRecipe(query.get("householdId")!), visibility: "PRIVATE", title: "Handwritten pancakes", source: "Rezeptfoto",
      ingredients: [{ name: "Flour", amount: "250", unit: "g", group: "", note: "" }, { name: "Milk", amount: null, unit: "ml", group: "", note: "Unreadable amount" }],
      steps: [{ instruction: "Mix and cook.", durationSeconds: null }] };
    return route.fulfill({ json: { draft, imageDataUrl: null, warnings: ["Check handwritten amounts before saving."] } });
  });
  await page.route("**/api/v1/recipes", async route => {
    if (route.request().method() === "POST") creates++;
    await route.continue();
  });
  await page.goto("/");
  await page.getByLabel("E-Mail-Adresse", { exact: true }).fill("browser@example.test");
  await page.getByLabel("Passwort", { exact: true }).fill("browser-test-password-long");
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await page.getByRole("navigation", { name: "Navigation", exact: true }).getByRole("button", { name: "Recipes", exact: true }).click();
  await page.getByRole("button", { name: "Add recipe", exact: true }).first().click();
  const panel = page.getByRole("region", { name: "Recipe from photo", exact: true });
  await panel.getByRole("button", { name: "Continue with ChatGPT", exact: true }).click();
  await expect(panel.getByLabel("Connection code (valid for 10 minutes)")).toHaveValue("a".repeat(64));
  await expect(panel.getByRole("link", { name: "Download sign-in helper" })).toHaveAttribute("href", "/tools/chatgpt-connect.mjs");
  await page.setViewportSize({ width: 390, height: 1000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  status.accounts.push({ id: "account", email: "photo@example.test", label: "ChatGPT 1", connected: true, active: true, blocked: false, creditsConfirmed: false });
  await panel.getByRole("button", { name: "Refresh connection status" }).click();
  await expect(panel.getByRole("button", { name: "Recognize photo and open preview" })).toBeDisabled();
  await panel.getByLabel("I have set this app's credit limit to 0 for this ChatGPT account.").check();
  await panel.getByRole("button", { name: "Confirm setting", exact: true }).click();
  await panel.getByRole("button", { name: "Load models", exact: true }).click();
  await panel.getByLabel("Recognition model", { exact: true }).selectOption("vision-test");
  await panel.getByLabel("Recipe photo", { exact: true }).setInputFiles({ name: "handwriting.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64") });
  await expect(panel.getByRole("img", { name: "Selected recipe photo" })).toBeVisible();
  expect(photoCalls).toBe(0); expect(creates).toBe(0);
  const submit = panel.getByRole("button", { name: "Recognize photo and open preview" });
  await expect(submit).toBeDisabled();
  await panel.getByLabel("Send this photo to OpenAI for recognition using my ChatGPT plan.").check();
  await expect(submit).toBeEnabled();
  const consentSize = await panel.getByLabel("Send this photo to OpenAI for recognition using my ChatGPT plan.").boundingBox();
  expect(consentSize!.width).toBeLessThan(25); expect(consentSize!.height).toBeLessThan(25);
  for (const width of [390, 820]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: width === 390 ? "dark" : "light" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await submit.click();
  await expect(page.getByLabel("Recipe title", { exact: true })).toHaveValue("Handwritten pancakes");
  await expect(page.getByText("Check handwritten amounts before saving.", { exact: true })).toBeVisible();
  expect(photoCalls).toBe(1); expect(creates).toBe(0);
  await expect(page.getByLabel("Amount 2", { exact: true })).toHaveValue("");
  await page.getByLabel("Recipe title", { exact: true }).fill("Reviewed handwritten pancakes");
  await page.screenshot({ path: "test-results/photo-import-tablet.png", fullPage: true });
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reviewed handwritten pancakes", exact: true })).toBeVisible();
  expect(creates).toBe(1); expect(errors).toEqual([]);
});
