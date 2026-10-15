import { test, expect } from "@playwright/test";
import type { ChatgptStatus } from "../../shared/chatgpt";
import { emptyRecipe } from "../../shared/recipes";

test("administrator shares an existing connection in settings and members import without personal sign-in", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const status: ChatgptStatus = { enabled: true, secureOrigin: true, creditsDisabledConfirmed: true, canManageShared: true,
    accounts: [{ id: "admin-connection", email: "private-admin@example.test", label: "ChatGPT 1", connected: true, active: true, blocked: false, creditsConfirmed: true, provider: "device" }],
    shared: { enabled: false, connected: false, blocked: false, creditsConfirmed: false, provider: null, ownAccountId: null } };
  let photos = 0, shares = 0;
  await page.route("**/api/v1/chatgpt", route => route.fulfill({ json: status }));
  await page.route("**/api/v1/chatgpt/shared", route => {
    expect(route.request().method()).toBe("PUT"); expect(route.request().postDataJSON()).toEqual({ accountId: "admin-connection" }); shares++;
    status.shared = { enabled: true, connected: true, blocked: false, creditsConfirmed: true, provider: "device", ownAccountId: "admin-connection" };
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/v1/chatgpt/models", route => route.fulfill({ json: { models: [{ slug: "shared-vision", displayName: "Shared vision" }] } }));
  await page.route("**/api/v1/recipe-imports/photo/preview?**", route => {
    photos++; const query = new URL(route.request().url()).searchParams;
    expect(query.get("consent")).toBe("true"); expect(query.get("model")).toBe("shared-vision");
    return route.fulfill({ json: { draft: { ...emptyRecipe(query.get("householdId")!), title: "Shared photo preview", ingredients: [], steps: [] }, warnings: [], imageDataUrl: null } });
  });
  await page.goto("/");
  await page.getByLabel("E-Mail-Adresse", { exact: true }).fill("browser@example.test");
  await page.getByLabel("Passwort", { exact: true }).fill("browser-test-password-long");
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  const settings = page.getByRole("region", { name: "Shared ChatGPT connection", exact: true });
  await settings.getByRole("button", { name: "Use for all users", exact: true }).click();
  await expect(settings.getByRole("button", { name: "Active for all users", exact: true })).toBeDisabled(); expect(shares).toBe(1);
  // The import UI receives only public shared status for an ordinary member.
  status.canManageShared = false; status.accounts = []; status.shared!.ownAccountId = null;
  await page.getByRole("navigation", { name: "Navigation", exact: true }).getByRole("button", { name: "Recipes", exact: true }).click();
  await page.getByRole("button", { name: "Add recipe", exact: true }).first().click();
  const panel = page.getByRole("region", { name: "Recipe from photo", exact: true });
  await expect(panel.getByText("Shared ChatGPT connection", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Continue with ChatGPT", exact: true })).toHaveCount(0);
  await expect(panel.getByText("private-admin@example.test")).toHaveCount(0);
  await panel.getByRole("button", { name: "Load models", exact: true }).click();
  await panel.getByLabel("Recognition model", { exact: true }).selectOption("shared-vision");
  await panel.getByLabel("Recipe photo", { exact: true }).setInputFiles({ name: "recipe.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64") });
  const submit = panel.getByRole("button", { name: "Recognize photo and open preview" });
  await expect(submit).toBeDisabled(); expect(photos).toBe(0);
  await panel.getByLabel("Send this photo to OpenAI for recognition using the shared ChatGPT connection.").check();
  await expect(submit).toBeEnabled();
  for (const width of [390, 820]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: width === 390 ? "dark" : "light" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  // A server-side block must also be visible after refreshing status.
  status.shared!.blocked = true;
  await panel.getByRole("button", { name: "Refresh connection status", exact: true }).click();
  await expect(submit).toBeDisabled();
  await expect(panel.getByText("The shared connection is unavailable or not yet approved. Please contact the administrator.", { exact: true })).toBeVisible();
  status.shared!.blocked = false;
  await panel.getByRole("button", { name: "Refresh connection status", exact: true }).click();
  await panel.getByRole("button", { name: "Load models", exact: true }).click();
  await panel.getByLabel("Recognition model", { exact: true }).selectOption("shared-vision");
  await submit.click();
  await expect(page.getByLabel("Recipe title", { exact: true })).toHaveValue("Shared photo preview");
  expect(photos).toBe(1); expect(errors).toEqual([]);
});
