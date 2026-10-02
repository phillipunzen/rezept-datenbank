import test from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { buildApp } from "../../server/app";
import { readConfig } from "../../server/lib/config";
import { hashToken } from "../../server/lib/password";
import { emptyRecipe } from "../../shared/recipes";
import { changeMember } from "../../server/services/households";
if (
  !new URL(process.env.DATABASE_URL ?? "http://invalid").pathname.endsWith(
    "/rezeptdatenbank_test",
  )
)
  throw Error("Disposable DB required");
test("public catalog requires explicit creator consent and filters source/private data with immediate revocation", async () => {
  const db = new PrismaClient(),
    uploadDir = await mkdtemp(join(tmpdir(), "catalog-"));
  const config = readConfig({
    ...process.env,
    APP_ORIGIN: "http://catalog.test",
    UPLOAD_DIR: uploadDir,
    LOG_LEVEL: "silent",
    PUBLIC_CATALOG_ENABLED: "true",
  });
  const app = await buildApp(db, config),
    off = await buildApp(db, { ...config, publicCatalogEnabled: false });
  async function account(
    role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER",
    householdId?: string,
  ) {
    const token = randomBytes(32).toString("hex");
    const user = await db.user.create({
      data: {
        email: token + "@catalog.test",
        name: role,
        passwordHash: "unused-hash",
        memberships: {
          create: {
            role,
            household: householdId
              ? { connect: { id: householdId } }
              : { create: { name: "Private household" } },
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
    admin = await account("ADMIN", owner.householdId),
    editor = await account("EDITOR", owner.householdId),
    viewer = await account("VIEWER", owner.householdId),
    outsider = await account("OWNER");
  type Actor = typeof owner;
  async function request(
    actor: Actor | null,
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    payload?: object,
    status = 200,
    server = app,
  ) {
    const r = await server.inject({
      method,
      url: "/api/v1" + path,
      headers: actor?.headers ?? {},
      payload,
    });
    assert.equal(r.statusCode, status, r.body);
    return r.json();
  }
  const draft = {
    ...emptyRecipe(owner.householdId),
    title: "Öffentliche Tomatensuppe",
    description: "Frische Kräuter",
    visibility: "PRIVATE" as const,
    source: "Hidden provenance sentinel",
    sourceUrl: "https://hidden-provenance.example.test/recipe",
    notes: "Hidden personal sentinel",
    vegetarian: true,
    tags: ["Sommer"],
    categories: ["Suppen"],
    ingredients: [
      { name: "Tomaten", amount: "500", unit: "g", group: "Suppe", note: "" },
    ],
    steps: [
      {
        instruction: "Tomaten kochen.",
        durationSeconds: 120,
        ingredientIndexes: [0],
      },
    ],
    nutrition: {
      calories: "200",
      carbohydrates: null,
      fats: null,
      proteins: null,
      basis: "SERVING" as const,
      source: "Hidden nutrition sentinel",
    },
  };
  try {
    assert.equal(
      (await request(null, "GET", "/system")).publicCatalogEnabled,
      true,
    );
    assert.equal((await request(null, "GET", "/catalog/recipes")).total, 0);
    let recipe = (await request(owner, "POST", "/recipes", draft, 201)).recipe;
    const path = `/recipes/${recipe.id}/publication`,
      publicPath = `/catalog/recipes/${recipe.id}`;
    const imageBytes = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#a12345" },
    })
      .webp()
      .toBuffer();
    await writeFile(join(uploadDir, "catalog-test.webp"), imageBytes);
    const image = await db.recipeImage.create({
      data: {
        recipeId: recipe.id,
        storageKey: "catalog-test.webp",
        bytes: imageBytes.length,
      },
    });
    const imagePath = publicPath + "/images/" + image.id;
    const imageStatus = async (status: number, server = app) => {
      const r = await server.inject({
        method: "GET",
        url: "/api/v1" + imagePath,
      });
      assert.equal(r.statusCode, status, r.body);
      if (status === 200) {
        assert.deepEqual(r.rawPayload, imageBytes);
        assert.equal(r.headers["cache-control"], "no-store");
      }
    };
    await request(null, "GET", publicPath, undefined, 404);
    await imageStatus(404);
    await request(null, "GET", path, undefined, 401);
    await request(outsider, "GET", path, undefined, 404);
    for (const actor of [admin, editor, viewer])
      await request(actor, "GET", path, undefined, 404);
    let pub = (await request(owner, "GET", path)).publication;
    const body = (published = true) => ({
      published,
      recipeRevision: recipe.revision,
      revision: pub.revision,
      confirmedPublic: true,
    });
    await request(
      owner,
      "PUT",
      path,
      { ...body(), confirmedPublic: false },
      400,
    );
    await request(
      owner,
      "PUT",
      path,
      { ...body(), recipeRevision: recipe.revision + 1 },
      409,
    );
    pub = (await request(owner, "PUT", path, body())).publication;
    assert.equal(pub.published, true);
    assert.equal(pub.url, config.origin + `/entdecken/${recipe.id}`);
    let publicData = await request(null, "GET", publicPath);
    for (const text of [
      draft.source,
      draft.sourceUrl,
      draft.notes,
      draft.nutrition.source,
      owner.id,
      owner.householdId,
      owner.headers.cookie,
      "passwordHash",
      "storageKey",
    ])
      assert.equal(JSON.stringify(publicData).includes(text), false, text);
    for (const field of [
      "source",
      "sourceUrl",
      "notes",
      "creatorId",
      "householdId",
      "deviceData",
      "ratings",
    ])
      assert.equal(field in publicData.recipe, false, field);
    assert.equal("source" in publicData.recipe.nutrition, false);
    assert.equal(publicData.schemaOrg.url, pub.url);
    assert.equal(publicData.recipe.ingredients[0].name, "Tomaten");
    await imageStatus(200);
    const card = await request(
      null,
      "GET",
      "/catalog/recipes?q=Sommer&diet=vegetarian&pageSize=1",
    );
    assert.equal(card.total, 1);
    assert.equal(card.recipes[0].id, recipe.id);
    assert.equal("source" in card.recipes[0], false);
    assert.equal(
      (await request(null, "GET", "/catalog/recipes?q=Suppen")).total,
      1,
    );
    assert.equal(
      (await request(null, "GET", "/catalog/recipes?q=Hidden")).total,
      0,
    );
    assert.equal(
      (await request(null, "GET", "/catalog/recipes?diet=vegan")).total,
      0,
    );
    assert.equal(
      (await request(null, "GET", "/catalog/recipes?page=2&pageSize=1")).recipes
        .length,
      0,
    );
    await request(null, "GET", "/catalog/recipes?pageSize=100", undefined, 400);
    assert.equal(
      (await request(owner, "GET", `/recipes/${recipe.id}`)).recipe.source,
      draft.source,
    );
    await db.recipeGrant.create({
      data: { recipeId: recipe.id, userId: editor.id, permission: "EDIT" },
    });
    for (const actor of [admin, editor])
      await request(actor, "PUT", path, body(), actor === editor ? 403 : 404);
    recipe = (
      await request(owner, "PATCH", `/recipes/${recipe.id}`, {
        ...draft,
        title: "Tomatensuppe aktualisiert",
        revision: recipe.revision,
      })
    ).recipe;
    assert.equal(
      (await request(null, "GET", publicPath)).recipe.title,
      recipe.title,
    );
    const shared = await request(
      owner,
      "POST",
      `/recipes/${recipe.id}/share-links`,
      { days: 2, revision: recipe.revision },
    );
    const token = shared.url.split("/").pop();
    const linked = await request(null, "GET", `/public-recipes/${token}`);
    assert.equal("source" in linked.recipe, false);
    assert.equal("sourceUrl" in linked.recipe, false);
    assert.equal("source" in linked.recipe.nutrition, false);
    await request(null, "GET", "/catalog/recipes", undefined, 404, off);
    await request(null, "GET", publicPath, undefined, 404, off);
    await imageStatus(404, off);
    pub = (await request(owner, "PUT", path, body(false), 200, off))
      .publication;
    assert.equal(pub.published, false);
    await imageStatus(404);
    await request(owner, "PUT", path, body(), 404, off);
    pub = (await request(owner, "PUT", path, body())).publication;
    const concurrent = await Promise.all([
      app.inject({
        method: "PUT",
        url: "/api/v1" + path,
        headers: owner.headers,
        payload: body(false),
      }),
      app.inject({
        method: "PUT",
        url: "/api/v1" + path,
        headers: owner.headers,
        payload: body(false),
      }),
    ]);
    assert.deepEqual(concurrent.map((r) => r.statusCode).sort(), [200, 409]);
    pub = (await request(owner, "GET", path)).publication;
    pub = (await request(owner, "PUT", path, body())).publication;
    recipe = (
      await request(owner, "PATCH", `/recipes/${recipe.id}`, {
        ...draft,
        visibility: "HOUSEHOLD",
        revision: recipe.revision,
      })
    ).recipe;
    assert.equal(
      (await request(owner, "GET", path)).publication.published,
      false,
    );
    await request(null, "GET", publicPath, undefined, 404);
    pub = (await request(owner, "GET", path)).publication;
    for (const actor of [admin, editor, viewer])
      await request(actor, "PUT", path, body(), 403);
    pub = (await request(owner, "PUT", path, body())).publication;
    recipe = (
      await request(
        owner,
        "DELETE",
        `/recipes/${recipe.id}?revision=${recipe.revision}`,
      )
    ).recipe;
    await imageStatus(404);
    recipe = (
      await request(owner, "POST", `/recipes/${recipe.id}/restore`, {
        revision: recipe.revision,
      })
    ).recipe;
    await request(null, "GET", publicPath, undefined, 404);
    pub = (await request(owner, "GET", path)).publication;
    pub = (await request(owner, "PUT", path, body())).publication;
    await db.accountStatus.create({
      data: { userId: owner.id, disabled: true },
    });
    await request(null, "GET", publicPath, undefined, 404);
    await imageStatus(404);
    assert.equal((await request(null, "GET", "/catalog/recipes")).total, 0);
    await db.accountStatus.delete({ where: { userId: owner.id } });
    // Viewers can withdraw their existing publication, but cannot publish anew.
    await db.householdMember.update({
      where: {
        householdId_userId: {
          householdId: owner.householdId,
          userId: owner.id,
        },
      },
      data: { role: "VIEWER" },
    });
    await request(owner, "PUT", path, body(), 403);
    pub = (await request(owner, "PUT", path, body(false))).publication;
    await db.householdMember.update({
      where: {
        householdId_userId: {
          householdId: owner.householdId,
          userId: owner.id,
        },
      },
      data: { role: "OWNER" },
    });
    pub = (await request(owner, "PUT", path, body())).publication;
    // Membership in another household must never satisfy publication availability.
    await db.householdMember.create({
      data: {
        householdId: outsider.householdId,
        userId: owner.id,
        role: "EDITOR",
      },
    });
    await db.householdMember.update({
      where: {
        householdId_userId: {
          householdId: owner.householdId,
          userId: admin.id,
        },
      },
      data: { role: "OWNER" },
    });
    const household = await db.household.findUniqueOrThrow({
      where: { id: owner.householdId },
    });
    await changeMember(
      db,
      admin.id,
      owner.householdId,
      owner.id,
      null,
      household.revision,
    );
    await request(null, "GET", publicPath, undefined, 404);
    await imageStatus(404);
    await db.householdMember.create({
      data: {
        householdId: owner.householdId,
        userId: owner.id,
        role: "EDITOR",
      },
    });
    await request(null, "GET", publicPath, undefined, 404);
    assert.equal(
      (await request(owner, "GET", path)).publication.published,
      false,
    );
  } finally {
    await app.close();
    await off.close();
    await db.$disconnect();
    await rm(uploadDir, { recursive: true, force: true });
  }
});
