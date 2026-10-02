import { test, expect } from "@playwright/test";
test("Cookidoo connects only with explicit consent, previews before activation and reviews conflicts", async ({
  page,
}) => {
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
  const target = await page.evaluate(async () => {
    const householdId = (await (await fetch("/api/v1/households")).json())
      .households[0].household.id;
    const r = await fetch("/api/v1/shopping-lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ householdId, name: "Cookidoo browser" }),
    });
    if (!r.ok) throw Error(await r.text());
    return { householdId, list: (await r.json()).list };
  });
  let http = false,
    connection: any = null,
    connected = 0,
    activated = 0,
    resolved = 0,
    deleted = 0;
  await page.route("**/api/v1/cookidoo**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      method = request.method();
    let body: object;
    if (url.pathname.endsWith("/options"))
      body = { enabled: true, secureOrigin: false, allowHttp: http };
    else if (url.pathname.endsWith("/connect")) {
      const input = request.postDataJSON();
      expect(input.password).toBe("cookidoo-browser-password");
      expect(input.confirmedSharing).toBe(true);
      expect(input.confirmedHttp).toBe(true);
      connected++;
      connection = {
        id: "conn",
        householdId: target.householdId,
        listId: target.list.id,
        listName: target.list.name,
        accountEmail: input.email,
        market: "de",
        paused: true,
        status: "PENDING",
        revision: 1,
        lastSyncedAt: null,
        lastError: "",
        running: false,
        requested: false,
        report: { remoteCount: 3, localCount: 0, conflicts: [] },
      };
      body = { connection };
    } else if (method === "PATCH") {
      expect(request.postDataJSON().confirmedBidirectional).toBe(true);
      activated++;
      connection = {
        ...connection,
        paused: false,
        status: "CONFLICT",
        revision: 2,
        report: {
          remoteCount: 3,
          localCount: 3,
          conflicts: [
            {
              id: "pair",
              pairId: "pair",
              localId: "local",
              remoteKey: "ingredient:salt",
              reason: "INGREDIENT_READONLY",
              local: {
                fields: {
                  name: "Andere Zutat",
                  amount: "1",
                  unit: "TL",
                  note: "",
                },
                checked: false,
              },
              remote: {
                id: "salt",
                key: "ingredient:salt",
                kind: "ingredient",
                name: "Salz",
                description: "1 TL",
                preparation: "",
                checked: false,
              },
              allowLocal: false,
            },
          ],
        },
      };
      body = { connection };
    } else if (url.pathname.endsWith("/resolve")) {
      expect(request.postDataJSON().choice).toBe("REMOTE");
      resolved++;
      connection = {
        ...connection,
        status: "ACTIVE",
        revision: 3,
        report: { remoteCount: 3, localCount: 3, conflicts: [] },
      };
      body = { connection };
    } else if (method === "DELETE") {
      deleted++;
      connection = null;
      body = { ok: true };
    } else body = { connection };
    await route.fulfill({ json: body });
  });
  const nav = page.getByRole("navigation", { name: "Navigation", exact: true });
  await nav.getByRole("button", { name: "Shopping list", exact: true }).click();
  await page.getByRole("button", { name: target.list.name }).click();
  const panel = page.getByRole("region", {
    name: "Cookidoo connection",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "Connect Cookidoo", exact: true })
    .click();
  await expect(panel).toContainText("Open this app over HTTPS");
  expect(connected).toBe(0);
  // Re-mount with the explicitly configured development HTTP option.
  http = true;
  await nav.getByRole("button", { name: "Recipes", exact: true }).click();
  await nav.getByRole("button", { name: "Shopping list", exact: true }).click();
  await page.getByRole("button", { name: target.list.name }).click();
  await panel
    .getByRole("button", { name: "Connect Cookidoo", exact: true })
    .click();
  await panel
    .getByLabel("Cookidoo email", { exact: true })
    .fill("cookidoo@example.test");
  await panel
    .getByLabel("Cookidoo password", { exact: true })
    .fill("cookidoo-browser-password");
  await panel
    .getByRole("button", { name: "Connect and preview", exact: true })
    .click();
  expect(connected).toBe(0);
  await panel.getByRole("checkbox").nth(0).check();
  await panel
    .getByRole("button", { name: "Connect and preview", exact: true })
    .click();
  expect(connected).toBe(0);
  await panel.getByRole("checkbox").nth(1).check();
  await panel
    .getByRole("button", { name: "Connect and preview", exact: true })
    .click();
  await expect(panel).toContainText("Ready for confirmation");
  await expect(panel).toContainText("3 on Cookidoo");
  expect(connected).toBe(1);
  expect(activated).toBe(0);
  await expect(
    panel.getByRole("button", { name: "Sync now", exact: true }),
  ).toBeDisabled();
  page.on("dialog", (dialog) => void dialog.accept());
  await panel.getByRole("button", { name: "Enable sync", exact: true }).click();
  await expect(panel).toContainText("Review needed");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/cookidoo-mobile.png",
    fullPage: true,
  });
  await expect(
    panel.getByRole("button", { name: "Use app", exact: true }),
  ).toBeDisabled();
  await panel
    .getByRole("button", { name: "Use Cookidoo", exact: true })
    .click();
  await expect(panel).toContainText("Connected");
  expect(resolved).toBe(1);
  await panel.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "Connect Cookidoo", exact: true }),
  ).toBeVisible();
  expect(deleted).toBe(1);
  expect(errors).toEqual([]);
});
