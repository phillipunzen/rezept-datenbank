import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { PrismaClient, type HouseholdRole } from "@prisma/client";
import { buildApp } from "../../server/app";
import { readConfig } from "../../server/lib/config";
import { hashToken, hashPassword } from "../../server/lib/password";
import { emptyRecipe, type RecipeDetail } from "../../shared/recipes";
if (
  !process.env.DATABASE_URL ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("/rezeptdatenbank_test")
)
  throw new Error("Nur in der separaten Testdatenbank ausführen.");
test("private recipe grants guard details, search, metadata, images and concurrent authorization", async () => {
  const db = new PrismaClient();
  const uploadDir = await mkdtemp(join(tmpdir(), "sharing-images-"));
  const config = readConfig({
    ...process.env,
    APP_ORIGIN: "http://sharing.test",
    LOG_LEVEL: "silent",
    UPLOAD_DIR: uploadDir,
  });
  const app = await buildApp(db, config);
  const passwordHash = await hashPassword("sharing-test-password-long");
  async function account(
    role: HouseholdRole,
    householdId?: string,
    isAdmin = false,
  ) {
    const token = randomBytes(32).toString("hex");
    const user = await db.user.create({
      data: {
        name: role,
        email: `${randomBytes(8).toString("hex")}@example.test`,
        passwordHash,
        isAdmin,
        memberships: {
          create: {
            role,
            ...(householdId
              ? { household: { connect: { id: householdId } } }
              : { household: { create: { name: "Private Küche" } } }),
          },
        },
      },
      include: { memberships: true },
    });
    await db.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 180000),
      },
    });
    return {
      id: user.id,
      householdId: user.memberships[0].householdId,
      headers: { origin: config.origin, cookie: `session=${token}` },
    };
  }
  type Actor = Awaited<ReturnType<typeof account>>;
  const owner = await account("OWNER"),
    admin = await account("ADMIN", owner.householdId),
    editor = await account("EDITOR", owner.householdId),
    viewer = await account("VIEWER", owner.householdId),
    outsider = await account("OWNER", undefined, true);
  const request = (
    actor: Actor,
    method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
    url: string,
    payload?: object,
  ) => app.inject({ method, url, payload, headers: actor.headers });
  const data = {
    ...emptyRecipe(owner.householdId),
    visibility: "PRIVATE" as const,
    title: "Privates Safranrezept",
    tags: ["PrivaterTag"],
    categories: ["PrivateKategorie"],
    ingredients: [
      {
        name: "GeheimeVorratszutat",
        amount: "1",
        unit: "kg",
        group: "",
        note: "",
      },
    ],
    steps: [{ instruction: "Geheim kochen.", durationSeconds: null }],
  };
  let recipe: RecipeDetail;
  async function read() {
    const result = await request(owner, "GET", `/api/v1/recipes/${recipe.id}`);
    assert.equal(result.statusCode, 200);
    recipe = result.json().recipe;
    return recipe;
  }
  async function grant(grants: { userId: string; permission: string }[]) {
    await read();
    const result = await request(
      owner,
      "PUT",
      `/api/v1/recipes/${recipe.id}/access`,
      { revision: recipe.revision, grants },
    );
    assert.equal(result.statusCode, 200, result.body);
    recipe = result.json().recipe;
  }
  async function householdRevision() {
    return (
      await request(owner, "GET", `/api/v1/households/${owner.householdId}`)
    ).json().household.revision as number;
  }
  try {
    const created = await request(owner, "POST", "/api/v1/recipes", data);
    assert.equal(created.statusCode, 201, created.body);
    recipe = created.json().recipe;
    assert.equal(recipe.visibility, "PRIVATE");
    assert.equal(recipe.canManageAccess, true);
    const publicData = {
      ...emptyRecipe(owner.householdId),
      title: "Öffentliches Haushaltsrezept",
      ingredients: [
        {
          name: "ÖffentlicheZutat",
          amount: "1",
          unit: "g",
          group: "",
          note: "",
        },
      ],
      steps: [{ instruction: "Kochen.", durationSeconds: null }],
    };
    assert.equal(
      (await request(owner, "POST", "/api/v1/recipes", publicData)).statusCode,
      201,
    );
    const png = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const boundary = "sharing-test-boundary";
    const multipart = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = (actor: Actor) =>
      app.inject({
        method: "POST",
        url: `/api/v1/recipes/${recipe.id}/images?revision=${recipe.revision}`,
        headers: {
          ...actor.headers,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: multipart,
      });
    const imageResponse = await upload(owner);
    assert.equal(imageResponse.statusCode, 201, imageResponse.body);
    recipe = imageResponse.json().recipe;
    const imageUrl = recipe.images[0].url;
    for (const actor of [admin, editor, viewer, outsider]) {
      assert.equal(
        (await request(actor, "GET", `/api/v1/recipes/${recipe.id}`))
          .statusCode,
        404,
      );
      assert.equal((await request(actor, "GET", imageUrl)).statusCode, 404);
    }
    for (const actor of [admin, editor, viewer]) {
      const list = await request(
        actor,
        "GET",
        `/api/v1/recipes?householdId=${owner.householdId}`,
      );
      assert.equal(list.json().total, 1);
      assert.equal(list.json().recipes[0].title, publicData.title);
      assert.equal(
        (
          await request(
            actor,
            "GET",
            `/api/v1/recipes?householdId=${owner.householdId}&q=GeheimeVorratszutat`,
          )
        ).json().total,
        0,
      );
      const metadata = (
        await request(
          actor,
          "GET",
          `/api/v1/recipe-metadata?householdId=${owner.householdId}`,
        )
      ).json();
      assert.ok(!metadata.ingredients.includes("GeheimeVorratszutat"));
      assert.ok(!metadata.tags.includes("PrivaterTag"));
      assert.ok(!metadata.categories.includes("PrivateKategorie"));
      assert.ok(!metadata.units.includes("kg"));
    }
    assert.equal(
      (
        await request(viewer, "PUT", `/api/v1/recipes/${recipe.id}/favorite`, {
          favorite: true,
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await request(owner, "PUT", `/api/v1/recipes/${recipe.id}/access`, {
          revision: recipe.revision,
          grants: [{ userId: outsider.id, permission: "VIEW" }],
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await request(owner, "PUT", `/api/v1/recipes/${recipe.id}/access`, {
          revision: recipe.revision,
          grants: [{ userId: viewer.id, permission: "EDIT" }],
        })
      ).statusCode,
      400,
    );
    await grant([{ userId: editor.id, permission: "VIEW" }]);
    const shared = (
      await request(editor, "GET", `/api/v1/recipes/${recipe.id}`)
    ).json().recipe;
    assert.equal(shared.canEdit, false);
    assert.equal(shared.canManageAccess, false);
    assert.equal((await request(editor, "GET", imageUrl)).statusCode, 200);
    assert.equal(
      (
        await request(editor, "PATCH", `/api/v1/recipes/${recipe.id}`, {
          ...data,
          revision: recipe.revision,
        })
      ).statusCode,
      403,
    );
    assert.equal((await upload(editor)).statusCode, 403);
    assert.equal(
      (await request(editor, "GET", `/api/v1/recipes/${recipe.id}/access`))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await request(editor, "PUT", `/api/v1/recipes/${recipe.id}/favorite`, {
          favorite: true,
        })
      ).statusCode,
      200,
    );
    assert.equal((await read()).favorite, false);
    await grant([
      { userId: editor.id, permission: "EDIT" },
      { userId: viewer.id, permission: "VIEW" },
    ]);
    assert.equal(
      (
        await request(editor, "PATCH", `/api/v1/recipes/${recipe.id}`, {
          ...data,
          visibility: "HOUSEHOLD",
          revision: recipe.revision,
        })
      ).statusCode,
      403,
    );
    const edited = await request(
      editor,
      "PATCH",
      `/api/v1/recipes/${recipe.id}`,
      { ...data, title: "Privat bearbeitet", revision: recipe.revision },
    );
    assert.equal(edited.statusCode, 200, edited.body);
    recipe = edited.json().recipe;
    assert.equal(recipe.canEdit, true);
    assert.equal(recipe.canManageAccess, false);
    assert.equal(
      (
        await request(editor, "PUT", `/api/v1/recipes/${recipe.id}/access`, {
          revision: recipe.revision,
          grants: [],
        })
      ).statusCode,
      403,
    );
    // A request already in flight must recheck a grant after the household lock.
    let pendingWrite: ReturnType<typeof request> | undefined;
    let writeFinished = false;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Household WHERE id = ${owner.householdId} FOR UPDATE`;
      pendingWrite = request(editor, "PATCH", `/api/v1/recipes/${recipe.id}`, {
        ...data,
        title: "Must not be saved",
        revision: recipe.revision,
      }).then((result) => {
        writeFinished = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(
        writeFinished,
        false,
        "Recipe mutation waits for household authorization lock",
      );
      await tx.recipeGrant.update({
        where: { recipeId_userId: { recipeId: recipe.id, userId: editor.id } },
        data: { permission: "VIEW" },
      });
      await tx.recipe.update({
        where: { id: recipe.id },
        data: { revision: { increment: 1 } },
      });
    });
    assert.equal(
      (await pendingWrite!).statusCode,
      403,
      "Revoked write grant is rechecked after lock",
    );
    await read();
    assert.equal(recipe.title, "Privat bearbeitet");
    await grant([
      { userId: editor.id, permission: "EDIT" },
      { userId: viewer.id, permission: "VIEW" },
    ]);
    const previousRevision = recipe.revision;
    assert.equal(
      (
        await request(
          owner,
          "PATCH",
          `/api/v1/households/${owner.householdId}/members/${editor.id}`,
          { role: "VIEWER", revision: await householdRevision() },
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await request(editor, "GET", `/api/v1/recipes/${recipe.id}`)).json()
        .recipe.canEdit,
      false,
    );
    assert.equal(
      (
        await request(editor, "PATCH", `/api/v1/recipes/${recipe.id}`, {
          ...data,
          revision: previousRevision,
        })
      ).statusCode,
      403,
    );
    await read();
    assert.ok(recipe.revision > previousRevision);
    assert.equal(
      (
        await db.recipeGrant.findUniqueOrThrow({
          where: {
            recipeId_userId: { recipeId: recipe.id, userId: editor.id },
          },
        })
      ).permission,
      "VIEW",
    );
    assert.equal(
      (
        await request(
          owner,
          "PATCH",
          `/api/v1/households/${owner.householdId}/members/${editor.id}`,
          { role: "EDITOR", revision: await householdRevision() },
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await request(editor, "GET", `/api/v1/recipes/${recipe.id}`)).json()
        .recipe.canEdit,
      false,
      "Promoting a reader does not resurrect editing grants",
    );
    await grant([]);
    assert.equal((await request(editor, "GET", imageUrl)).statusCode, 404);
    assert.equal(
      (await request(viewer, "GET", `/api/v1/recipes/${recipe.id}`)).statusCode,
      404,
    );
    await grant([{ userId: editor.id, permission: "EDIT" }]);
    const published = await request(
      owner,
      "PATCH",
      `/api/v1/recipes/${recipe.id}`,
      { ...data, visibility: "HOUSEHOLD", revision: recipe.revision },
    );
    assert.equal(published.statusCode, 200, published.body);
    recipe = published.json().recipe;
    assert.equal(
      await db.recipeGrant.count({ where: { recipeId: recipe.id } }),
      0,
    );
    assert.equal(
      (await request(viewer, "GET", `/api/v1/recipes/${recipe.id}`)).statusCode,
      200,
    );
    const privateAgain = await request(
      owner,
      "PATCH",
      `/api/v1/recipes/${recipe.id}`,
      { ...data, revision: recipe.revision },
    );
    assert.equal(privateAgain.statusCode, 200);
    recipe = privateAgain.json().recipe;
    assert.equal(
      (await request(editor, "GET", `/api/v1/recipes/${recipe.id}`)).statusCode,
      404,
    );
    await grant([{ userId: editor.id, permission: "VIEW" }]);
    assert.equal(
      (
        await request(
          owner,
          "DELETE",
          `/api/v1/households/${owner.householdId}/members/${editor.id}?revision=${await householdRevision()}`,
        )
      ).statusCode,
      200,
    );
    assert.equal(
      await db.recipeGrant.count({
        where: { userId: editor.id, recipeId: recipe.id },
      }),
      0,
    );
    assert.equal(
      (await request(editor, "GET", `/api/v1/recipes/${recipe.id}`)).statusCode,
      404,
    );
    assert.equal((await request(editor, "GET", imageUrl)).statusCode, 404);
    assert.equal(
      (await request(editor, "GET", "/api/v1/auth/me")).statusCode,
      200,
      "Removing membership does not invalidate an unrelated account session",
    );
  } finally {
    await app.close();
    await db.$disconnect();
    await rm(uploadDir, { recursive: true, force: true });
  }
});
