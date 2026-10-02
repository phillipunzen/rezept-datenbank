import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../../server/app";
import { readConfig } from "../../server/lib/config";
import { hashPassword, hashToken } from "../../server/lib/password";
import { emptyRecipe } from "../../shared/recipes";
if (
  !process.env.DATABASE_URL ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("/rezeptdatenbank_test")
)
  throw new Error("Disposable test DB required");
test("planning, cookbooks and shopping enforce privacy, roles, exact sums, revisions and personal history", async () => {
  const db = new PrismaClient();
  const config = readConfig({
    ...process.env,
    APP_ORIGIN: "http://planning.test",
    LOG_LEVEL: "silent",
  });
  const app = await buildApp(db, config);
  async function account(
    role: "OWNER" | "EDITOR" | "VIEWER",
    householdId?: string,
  ) {
    const token = randomBytes(32).toString("hex");
    const user = await db.user.create({
      data: {
        name: role,
        email: `${randomBytes(8).toString("hex")}@planning.test`,
        passwordHash: await hashPassword("planning-password-long"),
        memberships: {
          create: {
            role,
            ...(householdId
              ? { household: { connect: { id: householdId } } }
              : { household: { create: { name: "Plan test" } } }),
          },
        },
      },
      include: { memberships: true },
    });
    await db.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    return {
      id: user.id,
      householdId: user.memberships[0].householdId,
      headers: { cookie: `session=${token}`, origin: config.origin },
    };
  }
  const owner = await account("OWNER"),
    editor = await account("EDITOR", owner.householdId),
    viewer = await account("VIEWER", owner.householdId),
    outsider = await account("OWNER");
  type Actor = typeof owner;
  async function request(
    actor: Actor,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    payload?: object,
    status = 200,
  ) {
    const response = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: actor.headers,
      payload,
    });
    assert.equal(response.statusCode, status, response.body);
    return response.json();
  }
  try {
    await request(
      outsider,
      "GET",
      `/cookbooks?householdId=${owner.householdId}`,
      undefined,
      404,
    );
    await request(
      viewer,
      "POST",
      "/cookbooks",
      { householdId: owner.householdId, name: "Denied", description: "" },
      403,
    );
    const makeRecipe = (
      title: string,
      amount: string,
      unit: string,
      visibility: "HOUSEHOLD" | "PRIVATE" = "HOUSEHOLD",
    ) =>
      request(
        owner,
        "POST",
        "/recipes",
        {
          ...emptyRecipe(owner.householdId),
          title,
          servings: 4,
          visibility,
          ingredients: [
            { name: "Kartoffeln", amount, unit, group: "", note: "" },
          ],
          steps: [{ instruction: "Kochen", durationSeconds: null }],
        },
        201,
      );
    const a = (await makeRecipe("A", "500", "g")).recipe,
      b = (await makeRecipe("B", "0.75", "kg")).recipe,
      secret = (await makeRecipe("Secret", "1", "g", "PRIVATE")).recipe;
    const book = (
      await request(owner, "POST", "/cookbooks", {
        householdId: owner.householdId,
        name: "Favorites",
        description: "test",
      })
    ).cookbook;
    await request(owner, "POST", `/cookbooks/${book.id}/recipes`, {
      recipeId: a.id,
      revision: 1,
      remove: false,
    });
    await request(owner, "POST", `/cookbooks/${book.id}/recipes`, {
      recipeId: secret.id,
      revision: 2,
      remove: false,
    });
    const visible = await request(
      editor,
      "GET",
      `/cookbooks?householdId=${owner.householdId}`,
    );
    assert.deepEqual(
      visible.cookbooks[0].recipes.map((r: { id: string }) => r.id),
      [a.id],
    );
    await request(
      owner,
      "PATCH",
      `/cookbooks/${book.id}`,
      { name: "stale", description: "", revision: 1 },
      409,
    );
    await request(
      editor,
      "POST",
      `/cookbooks/${book.id}/recipes`,
      { recipeId: secret.id, revision: 3, remove: false },
      404,
    );
    await request(owner, "POST", "/meal-plan", {
      householdId: owner.householdId,
      recipeId: secret.id,
      date: "2026-10-02",
      slot: "DINNER",
      servings: 4,
    });
    await request(owner, "POST", "/meal-plan", {
      householdId: owner.householdId,
      recipeId: a.id,
      date: "2026-10-02",
      slot: "LUNCH",
      servings: 4,
    });
    await request(owner, "POST", "/meal-plan", {
      householdId: owner.householdId,
      recipeId: b.id,
      date: "2026-10-03",
      slot: "DINNER",
      servings: 4,
    });
    assert.equal(
      (
        await request(
          editor,
          "GET",
          `/meal-plan?householdId=${owner.householdId}&from=2026-10-01&to=2026-10-07`,
        )
      ).entries.length,
      2,
    );
    await request(
      viewer,
      "POST",
      "/meal-plan",
      {
        householdId: owner.householdId,
        recipeId: a.id,
        date: "2026-10-02",
        slot: "LUNCH",
        servings: 4,
      },
      403,
    );
    await request(
      owner,
      "POST",
      "/meal-plan",
      {
        householdId: owner.householdId,
        recipeId: a.id,
        date: "2026-02-29",
        slot: "LUNCH",
        servings: 4,
      },
      400,
    );
    const list = (
      await request(owner, "POST", "/shopping-lists", {
        householdId: owner.householdId,
        name: "Market",
      })
    ).list;
    await request(
      owner,
      "POST",
      `/shopping-lists/${list.id}/from-recipe`,
      { recipeId: secret.id, servings: 4, revision: 1, sharePrivate: false },
      400,
    );
    await request(owner, "POST", `/shopping-lists/${list.id}/from-recipe`, {
      recipeId: a.id,
      servings: 4,
      revision: 1,
      sharePrivate: false,
    });
    await request(owner, "POST", `/shopping-lists/${list.id}/from-recipe`, {
      recipeId: b.id,
      servings: 4,
      revision: 2,
      sharePrivate: false,
    });
    let state = (
      await request(
        viewer,
        "GET",
        `/shopping-lists?householdId=${owner.householdId}`,
      )
    ).lists[0];
    assert.equal(state.items.length, 1);
    assert.equal(state.items[0].amount, "1250");
    assert.equal(state.items[0].unit, "g");
    await request(
      viewer,
      "PATCH",
      `/shopping-lists/${list.id}/items/${state.items[0].id}`,
      { checked: true, revision: 3 },
      403,
    );
    const concurrent = await Promise.all([
      app.inject({
        method: "PATCH",
        url: `/api/v1/shopping-lists/${list.id}/items/${state.items[0].id}`,
        headers: owner.headers,
        payload: { checked: true, revision: 3 },
      }),
      app.inject({
        method: "PATCH",
        url: `/api/v1/shopping-lists/${list.id}/items/${state.items[0].id}`,
        headers: editor.headers,
        payload: { checked: true, revision: 3 },
      }),
    ]);
    assert.deepEqual(concurrent.map((r) => r.statusCode).sort(), [200, 409]);
    await request(
      outsider,
      "GET",
      `/shopping-lists?householdId=${owner.householdId}`,
      undefined,
      404,
    );
    await request(
      owner,
      "POST",
      `/shopping-lists/${list.id}/from-plan`,
      {
        from: "2026-10-01",
        to: "2026-10-07",
        revision: 4,
        sharePrivate: false,
      },
      400,
    );
    state = (
      await request(
        owner,
        "GET",
        `/shopping-lists?householdId=${owner.householdId}`,
      )
    ).lists[0];
    assert.equal(state.revision, 4, "failed generation is atomic");
    await request(editor, "POST", `/shopping-lists/${list.id}/from-plan`, {
      from: "2026-10-01",
      to: "2026-10-07",
      revision: 4,
      sharePrivate: false,
    });
    state = (
      await request(
        owner,
        "GET",
        `/shopping-lists?householdId=${owner.householdId}`,
      )
    ).lists[0];
    assert.equal(
      state.items.find((item: { checked: boolean }) => !item.checked).amount,
      "1250",
    );
    const editItem = state.items.find(
      (item: { checked: boolean }) => !item.checked,
    );
    await request(
      owner,
      "PATCH",
      `/shopping-lists/${list.id}/items/${editItem.id}`,
      {
        revision: state.revision,
        name: "New potatoes",
        amount: "2.5",
        unit: "kg",
        note: "Floury",
        checked: false,
      },
    );
    const edited = (
      await request(
        owner,
        "GET",
        `/shopping-lists?householdId=${owner.householdId}`,
      )
    ).lists[0].items.find((item: { id: string }) => item.id === editItem.id);
    assert.equal(edited.name, "New potatoes");
    assert.equal(edited.amount, "2500");
    assert.equal(edited.unit, "g");
    assert.equal(edited.note, "Floury");
    const key = randomBytes(16).toString("hex");
    const completed = await Promise.all([
      request(viewer, "POST", `/recipes/${a.id}/cooking-history`, {
        servings: 6,
        note: "Good",
        requestKey: key,
      }),
      request(viewer, "POST", `/recipes/${a.id}/cooking-history`, {
        servings: 6,
        note: "Good",
        requestKey: key,
      }),
    ]);
    assert.equal(completed[0].event.id, completed[1].event.id);
    assert.equal(
      (
        await request(
          viewer,
          "GET",
          `/cooking-history?householdId=${owner.householdId}`,
        )
      ).events.length,
      1,
    );
    assert.equal(
      (
        await request(
          owner,
          "GET",
          `/cooking-history?householdId=${owner.householdId}`,
        )
      ).events.length,
      0,
    );
    await request(
      owner,
      "DELETE",
      `/cooking-history/${completed[0].event.id}`,
      undefined,
      404,
    );
    await request(
      viewer,
      "POST",
      `/recipes/${secret.id}/cooking-history`,
      { servings: 1, note: "", requestKey: randomBytes(16).toString("hex") },
      404,
    );
    await db.householdMember.delete({
      where: {
        householdId_userId: {
          householdId: owner.householdId,
          userId: editor.id,
        },
      },
    });
    await request(
      editor,
      "POST",
      `/shopping-lists/${list.id}/items`,
      { name: "After removal", amount: null, unit: "", note: "", revision: 6 },
      404,
    );
    await request(
      viewer,
      "DELETE",
      `/cooking-history/${completed[0].event.id}`,
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});
