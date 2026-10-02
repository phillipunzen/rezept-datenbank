import { test, expect, chromium } from "@playwright/test";
import { emptyRecipe } from "../../shared/recipes";
test("encrypted offline snapshot survives reload, shopping conflicts require review, logout locks other tabs", async () => {
  test.setTimeout(75000);
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      "--no-proxy-server",
      "--host-resolver-rules=MAP rezeptdatenbank.test 127.0.0.1",
      "--unsafely-treat-insecure-origin-as-secure=http://rezeptdatenbank.test:8081",
    ],
  });
  const context = await browser.newContext({
      baseURL: "http://rezeptdatenbank.test:8081",
    }),
    page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
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
    const fixtures = await page.evaluate(
      async (draft) => {
        const householdId = (await (await fetch("/api/v1/households")).json())
          .households[0].household.id;
        const post = async (path: string, body: object) => {
          const response = await fetch("/api/v1" + path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!response.ok) throw Error(await response.text());
          return response.json();
        };
        const recipe = (await post("/recipes", { ...draft, householdId }))
          .recipe;
        const list = (
          await post("/shopping-lists", {
            householdId,
            name: "Offline groceries",
          })
        ).list;
        await post(`/shopping-lists/${list.id}/items`, {
          name: "Offline potatoes",
          amount: "500",
          unit: "g",
          note: "",
          revision: list.revision,
        });
        await post("/meal-plan", {
          householdId,
          recipeId: recipe.id,
          date: new Date().toISOString().slice(0, 10),
          slot: "DINNER",
          servings: 4,
        });
        return { householdId, recipe, list };
      },
      {
        ...emptyRecipe(""),
        title: "Encrypted offline dinner",
        notes: "PRIVATE OFFLINE NOTE",
        ingredients: [
          {
            name: "Offline potatoes",
            amount: "500",
            unit: "g",
            group: "",
            note: "",
          },
        ],
        steps: [{ instruction: "Cook offline potatoes", durationSeconds: 5 }],
      },
    );
    const offline = await context.newPage();
    offline.on("pageerror", (e) => errors.push(e.message));
    await offline.goto("/offline.html");
    await offline.getByRole("button", { name: "English", exact: true }).click();
    await expect(offline.locator("#availability")).toHaveText(
      "Offline interface ready.",
    );
    await offline
      .getByLabel("Offline passphrase (at least 12 characters)", {
        exact: true,
      })
      .fill("offline-test-passphrase");
    await offline
      .getByRole("button", { name: "Unlock / create vault", exact: true })
      .click();
    await expect(offline.locator("#choices")).toContainText(
      fixtures.recipe.title,
    );
    await offline
      .getByLabel("Search recipes", { exact: true })
      .fill("No such recipe");
    await offline.getByRole("button", { name: "Search", exact: true }).click();
    await expect(offline.locator("#choices label")).toHaveCount(0);
    await expect(offline.locator("#selection-count")).not.toHaveText(
      "0 / 30 selected",
    );
    await offline
      .getByLabel("Search recipes", { exact: true })
      .fill(fixtures.recipe.title);
    await offline.getByRole("button", { name: "Search", exact: true }).click();
    await expect(offline.locator("#choices input")).toBeChecked();
    await offline
      .getByRole("button", { name: "Save selection offline", exact: true })
      .click();
    await expect(offline.locator("#feedback")).toHaveText(
      "Stored encrypted on this device.",
    );
    const storage = await offline.evaluate(
      async () =>
        new Promise<string>((resolve) => {
          const req = indexedDB.open("rezeptdatenbank-private-v1", 1);
          req.onsuccess = () => {
            const db = req.result,
              get = db.transaction("vault").objectStore("vault").get("current");
            get.onsuccess = () => {
              const record = get.result;
              resolve(
                JSON.stringify({
                  keys: Object.keys(record),
                  cipher: new TextDecoder().decode(record.cipher),
                }),
              );
              db.close();
            };
          };
        }),
    );
    expect(storage).not.toContain("PRIVATE OFFLINE NOTE");
    expect(storage).not.toContain(fixtures.recipe.title);
    await context.setOffline(true);
    await offline.reload();
    await offline.getByRole("button", { name: "English", exact: true }).click();
    await offline
      .getByLabel("Offline passphrase (at least 12 characters)", {
        exact: true,
      })
      .fill("wrong-offline-passphrase");
    await offline
      .getByRole("button", { name: "Unlock / create vault", exact: true })
      .click();
    await expect(offline.locator("#feedback")).toHaveText(
      "Incorrect passphrase or damaged data.",
    );
    await offline
      .getByLabel("Offline passphrase (at least 12 characters)", {
        exact: true,
      })
      .fill("offline-test-passphrase");
    await offline
      .getByRole("button", { name: "Unlock / create vault", exact: true })
      .click();
    await offline
      .getByRole("button", { name: fixtures.recipe.title, exact: true })
      .click();
    await expect(offline.locator("#detail")).toContainText(
      "Cook offline potatoes",
    );
    await offline
      .getByRole("checkbox", { name: "500 g Offline potatoes", exact: true })
      .check();
    await expect(offline.locator("#snapshot-info")).toContainText(
      "1 local changes",
    );
    await context.setOffline(false);
    await page.evaluate(async (id) => {
      const hh = (await (await fetch("/api/v1/households")).json())
        .households[0].household.id;
      const list = (
        await (await fetch("/api/v1/shopping-lists?householdId=" + hh)).json()
      ).lists.find((l: { id: string }) => l.id === id);
      const response = await fetch("/api/v1/shopping-lists/" + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Offline groceries renamed online",
          revision: list.revision,
        }),
      });
      if (!response.ok) throw Error(await response.text());
    }, fixtures.list.id);
    await offline
      .getByRole("button", { name: "Sync changes", exact: true })
      .click();
    await expect(offline.locator("#conflicts")).toContainText(
      "The list changed online.",
    );
    offline.once("dialog", (d) => d.accept());
    await offline
      .getByRole("button", { name: "Reapply local checkmarks", exact: true })
      .click();
    await expect(offline.locator("#snapshot-info")).toContainText(
      "0 local changes",
    );
    const checked = await page.evaluate(
      async (hh) =>
        (
          await (await fetch("/api/v1/shopping-lists?householdId=" + hh)).json()
        ).lists.find(
          (l: { name: string }) =>
            l.name === "Offline groceries renamed online",
        ).items[0].checked,
      fixtures.householdId,
    );
    expect(checked).toBe(true);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Show accounts and audit log", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Audit log", exact: true }),
    ).toBeVisible();
    const own = page
      .locator(".history-row")
      .filter({ hasText: "browser@example.test" });
    page.once("dialog", (d) => d.accept());
    await own.getByRole("button", { name: "Disable", exact: true }).click();
    await expect(page.locator(".error-box[role=alert]")).toContainText(
      "letzte aktive Administrator",
    );
    await page.evaluate(async (fixtures) => {
      await fetch(
        `/api/v1/recipes/${fixtures.recipe.id}?revision=${fixtures.recipe.revision}`,
        { method: "DELETE" },
      );
    }, fixtures);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(offline.locator("#vault")).toBeHidden();
    await expect(offline.locator("#detail")).toBeHidden();
    expect(await offline.locator("#recipes").textContent()).toBe("");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await browser.close();
  }
});
