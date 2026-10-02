import { test, expect } from "@playwright/test";
import { emptyRecipe } from "../../shared/recipes";

test("cooking mode covers the screen, scales ingredients, keeps step timers and exits safely", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
  const householdId = await page.evaluate(async () => {
    const response = await fetch("/api/v1/households");
    return (await response.json()).households[0].household.id as string;
  });
  const input = {
    ...emptyRecipe(householdId),
    title: "Kochmodus-Test",
    servings: 4,
    ingredients: [
      { name: "Reis", amount: "200", unit: "g", group: "", note: "" },
    ],
    steps: [
      { instruction: "Reis abwiegen.", durationSeconds: 5 },
      { instruction: "Reis garen.", durationSeconds: 10 },
      { instruction: "Anrichten.", durationSeconds: null },
    ],
  };
  const recipe = await page.evaluate(async (input) => {
    const response = await fetch("/api/v1/recipes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error("Fixture creation failed");
    return (await response.json()).recipe;
  }, input);
  await page.reload();
  await page.getByRole("button", { name: /Kochmodus-Test/ }).click();
  await page.getByLabel("Servings", { exact: true }).fill("6");
  const start = page.getByRole("button", {
    name: "Start cooking",
    exact: true,
  });
  const clockTime = new Date("2026-10-02T10:00:00Z");
  await page.clock.install({ time: clockTime });
  await page.clock.pauseAt(clockTime);
  await start.click();
  const mode = page.getByRole("dialog", { name: "Cooking mode", exact: true });
  await expect(mode).toBeVisible();
  await expect(mode.getByText("Requires HTTPS and a supported browser.", {exact: true})).toBeVisible();
  await mode.getByRole("button", {name:"Fullscreen", exact:true}).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await mode.getByRole("button", {name:"Exit fullscreen", exact:true}).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  const box = await mode.boundingBox();
  expect(box!.width).toBe(page.viewportSize()!.width);
  expect(box!.height).toBe(page.viewportSize()!.height);
  await expect(mode.getByText("6 Servings", { exact: true })).toBeVisible();
  await expect(mode.locator(".cooking-amount")).toHaveText("300 g");
  await mode.getByLabel("Reis check off", { exact: true }).check();
  await mode.getByRole("button", { name: "Start timer", exact: true }).click();
  await page.clock.runFor(2000);
  await expect(mode.getByLabel("Remaining time", { exact: true })).toHaveText(
    "0:03",
  );
  await mode.getByRole("button", { name: "Pause timer", exact: true }).click();
  await page.clock.fastForward(6000);
  await expect(mode.getByLabel("Remaining time", { exact: true })).toHaveText(
    "0:03",
  );
  await mode.getByRole("button", { name: "Resume timer", exact: true }).click();
  const warning = page.waitForEvent("dialog");
  // A cancelled reload never reaches a load event; bound that expected wait.
  const reload = page.reload({ timeout: 1000 }).catch(() => {});
  const reloadWarning = await warning;
  expect(reloadWarning.type()).toBe("beforeunload");
  await reloadWarning.dismiss();
  await reload;
  await expect(mode).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await mode
    .getByRole("button", { name: "Close cooking mode", exact: true })
    .click();
  await expect(mode).toBeVisible();
  await mode.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(
    mode.getByRole("heading", { name: "Reis garen.", exact: true }),
  ).toBeVisible();
  await mode.getByRole("button", { name: "Start timer", exact: true }).click();
  await page.clock.fastForward(3000);
  await expect(mode.locator(".cooking-timer-summary").first()).toContainText(
    "Time is up",
  );
  await expect(mode.getByLabel("Remaining time", { exact: true })).toHaveText(
    "0:07",
  );
  await mode.getByRole("button", { name: "Reset timer", exact: true }).click();
  await expect(mode.getByLabel("Remaining time", { exact: true })).toHaveText(
    "0:10",
  );
  await mode
    .getByRole("button", { name: "Previous step", exact: true })
    .click();
  await expect(mode.locator(".cooking-timer").getByRole("status")).toHaveText(
    "Time is up",
  );
  await expect(
    mode.getByLabel("Reis check off", { exact: true }),
  ).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await mode.evaluate((element) => element.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/cooking-mobile.png",
    fullPage: false,
  });
  await mode.getByRole("button", { name: "Next step", exact: true }).click();
  await mode.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(
    mode.getByRole("heading", { name: "Anrichten.", exact: true }),
  ).toBeVisible();
  await mode.getByLabel("Cooking note", {exact:true}).fill("Test completion");
  await mode
    .getByRole("button", { name: "Finish cooking", exact: true })
    .click();
  await expect(
    mode.getByRole("heading", {
      name: "All done! Enjoy your meal.",
      exact: true,
    }),
  ).toBeVisible();
  await mode
    .getByRole("button", { name: "Back to recipe", exact: true })
    .click();
  await expect(mode).toBeHidden();
  await expect(start).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  await start.click();
  await expect(mode.getByLabel("Remaining time", { exact: true })).toHaveText(
    "0:05",
  );
  await mode.getByRole("button", { name: "Start timer", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.keyboard.press("Escape");
  await expect(mode).toBeHidden();
  const history = await page.evaluate(async householdId => (await (await fetch(`/api/v1/cooking-history?householdId=${householdId}`)).json()).events, householdId);
  expect(history.filter((event: {recipe:{id:string}; note:string; servings:number}) => event.recipe.id === recipe.id && event.note === "Test completion" && event.servings === 6)).toHaveLength(1);
  const unchanged = await page.evaluate(
    async (id) => (await (await fetch(`/api/v1/recipes/${id}`)).json()).recipe,
    recipe.id,
  );
  expect(unchanged.revision).toBe(recipe.revision);
  expect(unchanged.servings).toBe(4);
  const deleted = await page.evaluate(async (recipe) => {
    const response = await fetch(
      `/api/v1/recipes/${recipe.id}?revision=${recipe.revision}`,
      {
        method: "DELETE",
      },
    );
    return response.ok;
  }, recipe);
  expect(deleted).toBe(true);
  expect(errors).toEqual([]);
});
