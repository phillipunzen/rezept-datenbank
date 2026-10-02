import test from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../server/app";
import { readConfig } from "../../server/lib/config";
import { hashToken, hashPassword } from "../../server/lib/password";
import { emptyRecipe, type RecipeDetail } from "../../shared/recipes";
if (
  !process.env.DATABASE_URL ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("/rezeptdatenbank_test")
)
  throw new Error("Tests nur in separater Test-DB erlaubt.");
test("recipe lifecycle protects households, roles, revisions, images and structured data", async () => {
  const db = new PrismaClient();
  const uploadDir = await mkdtemp(join(tmpdir(), "rezeptdatenbank-images-"));
  const config = readConfig({
    ...process.env,
    APP_ORIGIN: "http://recipes.test",
    LOG_LEVEL: "silent",
    UPLOAD_DIR: uploadDir,
  });
  let fetched = 0;
  const importImage = await sharp({
    create: { width: 12, height: 10, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const app = await buildApp(db, config, {
    recipeFetcher: async (url) => {
      fetched++;
      if (url.endsWith(".png"))
        return { body: importImage, url, contentType: "image/png" };
      return {
        body: Buffer.from(
          `<script type="application/ld+json">${JSON.stringify({
            "@type": "Recipe",
            name: "Importiertes Risotto",
            recipeYield: "2",
            recipeIngredient: ["100 g Reis"],
            recipeInstructions: [
              { "@type": "HowToStep", text: "Reis kochen." },
            ],
            image: "/risotto.png",
          })}</script>`,
        ),
        url,
        contentType: "text/html",
      };
    },
  });

  async function account(role: "OWNER" | "VIEWER", householdId?: string) {
    const token = randomBytes(32).toString("hex");
    const user = await db.user.create({
      data: {
        email: `${randomBytes(8).toString("hex")}@test.example`,
        name: role,
        passwordHash: await hashPassword("test-passphrase-long"),
        memberships: {
          create: {
            role,
            ...(householdId
              ? { household: { connect: { id: householdId } } }
              : { household: { create: { name: `Test ${role}` } } }),
          },
        },
      },
      include: { memberships: true },
    });
    await db.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    return {
      userId: user.id,
      householdId: user.memberships[0].householdId,
      headers: { origin: config.origin, cookie: `session=${token}` },
    };
  }
  const owner = await account("OWNER");
  const outsider = await account("OWNER");
  const viewer = await account("VIEWER", owner.householdId);
  for (const [headers, expected] of [
    [{ origin: config.origin }, 401],
    [viewer.headers, 403],
    [outsider.headers, 404],
  ] as const) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/recipe-imports/preview",
      headers,
      payload: {
        householdId: owner.householdId,
        url: "https://recipes.example.test/risotto",
      },
    });
    assert.equal(response.statusCode, expected, response.body);
  }
  assert.equal(
    fetched,
    0,
    "Permission failures must not issue external requests",
  );
  const preview = await app.inject({
    method: "POST",
    url: "/api/v1/recipe-imports/preview",
    headers: owner.headers,
    payload: {
      householdId: owner.householdId,
      url: "https://recipes.example.test/risotto",
    },
  });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().draft.title, "Importiertes Risotto");
  assert.ok(preview.json().imageDataUrl.startsWith("data:image/webp;base64,"));
  assert.equal(
    await db.recipe.count({ where: { householdId: owner.householdId } }),
    0,
    "Preview must not save a recipe",
  );
  const internalLink = await app.inject({
    method: "POST",
    url: "/api/v1/recipe-imports/preview",
    headers: owner.headers,
    payload: {
      householdId: owner.householdId,
      url: "http://192.168.10.70/private",
    },
  });
  assert.equal(internalLink.statusCode, 400);
  const data = {
    ...emptyRecipe(owner.householdId),
    title: "Pilzrisotto",
    description: "Cremig",
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 20,
    ingredients: [
      {
        name: "Reis",
        amount: "0.1",
        unit: "kg",
        group: "Für das Risotto",
        note: "",
      },
      {
        name: "Pilze",
        amount: "500",
        unit: "g",
        group: "Für das Risotto",
        note: "frisch",
      },
      {
        name: "Salz",
        amount: null,
        unit: "",
        group: "",
        note: "nach Geschmack",
      },
    ],
    steps: [
      { instruction: "Pilze schneiden.", durationSeconds: 60 },
      { instruction: "Reis garen.", durationSeconds: 1200 },
    ],
    tags: ["Italienisch", "italienisch"],
    categories: ["Abendessen"],
  };
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/recipes",
          payload: data,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/recipes",
          headers: viewer.headers,
          payload: data,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/recipes",
          headers: owner.headers,
          payload: {
            ...data,
            ingredients: [{ ...data.ingredients[0], amount: "1e3" }],
          },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/recipes",
          headers: owner.headers,
          payload: { ...data, sourceUrl: "javascript:alert(1)" },
        })
      ).statusCode,
      400,
    );
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/recipes",
      headers: owner.headers,
      payload: data,
    });
    assert.equal(created.statusCode, 201, created.body);
    let recipe: RecipeDetail = created.json().recipe;
    const id = recipe.id;
    assert.equal(recipe.ingredients[0].amount, "0.1");
    assert.equal(recipe.ingredients[0].unit, "kg");
    assert.equal(recipe.tags.length, 1);
    assert.equal(
      await db.recipeIngredientGroup.count({ where: { recipeId: id } }),
      1,
    );
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/recipes/${id}`,
          headers: outsider.headers,
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/v1/recipes/${id}`,
          headers: outsider.headers,
          payload: { ...data, revision: 1 },
        })
      ).statusCode,
      404,
    );
    const viewerGet = await app.inject({
      method: "GET",
      url: `/api/v1/recipes/${id}`,
      headers: viewer.headers,
    });
    assert.equal(viewerGet.statusCode, 200);
    assert.equal(viewerGet.json().recipe.canEdit, false);
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/v1/recipes/${id}`,
          headers: viewer.headers,
          payload: { ...data, revision: 1 },
        })
      ).statusCode,
      403,
    );
    const search = await app.inject({
      method: "GET",
      url: `/api/v1/recipes?householdId=${owner.householdId}&q=Pilze&maxMinutes=30`,
      headers: owner.headers,
    });
    assert.equal(search.statusCode, 200, search.body);
    assert.equal(search.json().total, 1);
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/recipes?householdId=${owner.householdId}&maxMinutes=15`,
          headers: owner.headers,
        })
      ).json().total,
      0,
    );
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/recipe-metadata?householdId=${owner.householdId}`,
          headers: outsider.headers,
        })
      ).statusCode,
      404,
    );
    const updated = await app.inject({
      method: "PATCH",
      url: `/api/v1/recipes/${id}`,
      headers: owner.headers,
      payload: {
        ...data,
        title: "Neues Risotto",
        ingredients: [...data.ingredients].reverse(),
        steps: [...data.steps].reverse(),
        revision: recipe.revision,
      },
    });
    assert.equal(updated.statusCode, 200, updated.body);
    recipe = updated.json().recipe;
    assert.equal(recipe.ingredients[0].name, "Salz");
    assert.equal(recipe.steps[0].instruction, "Reis garen.");
    assert.equal(await db.recipeVersion.count({ where: { recipeId: id } }), 1);
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/v1/recipes/${id}`,
          headers: owner.headers,
          payload: { ...data, revision: 1 },
        })
      ).statusCode,
      409,
    );
    const competing = await Promise.all(
      [1, 2].map((n) =>
        app.inject({
          method: "PATCH",
          url: `/api/v1/recipes/${id}`,
          headers: owner.headers,
          payload: {
            ...data,
            title: `Concurrent ${n}`,
            revision: recipe.revision,
          },
        }),
      ),
    );
    assert.deepEqual(competing.map((r) => r.statusCode).sort(), [200, 409]);
    recipe = competing.find((r) => r.statusCode === 200)!.json().recipe;
    const favorite = await app.inject({
      method: "PUT",
      url: `/api/v1/recipes/${id}/favorite`,
      headers: viewer.headers,
      payload: { favorite: true },
    });
    assert.equal(favorite.statusCode, 200, favorite.body);
    assert.equal(favorite.json().recipe.favorite, true);
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/recipes?householdId=${owner.householdId}&favorites=true`,
          headers: owner.headers,
        })
      ).json().total,
      0,
    );
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: `/api/v1/recipes/${id}/rating`,
          headers: viewer.headers,
          payload: { rating: 6 },
        })
      ).statusCode,
      400,
    );
    const rated = await app.inject({
      method: "PUT",
      url: `/api/v1/recipes/${id}/rating`,
      headers: viewer.headers,
      payload: { rating: 4 },
    });
    assert.equal(rated.json().recipe.averageRating, 4);
    function multipart(buffer: Buffer, mime = "image/png") {
      const boundary = "recipe-test-boundary";
      return {
        payload: Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: ${mime}\r\n\r\n`,
          ),
          buffer,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
        headers: {
          ...owner.headers,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
      };
    }
    const png = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#609a51" },
    })
      .png()
      .toBuffer();
    const spoof = await app.inject({
      method: "POST",
      url: `/api/v1/recipes/${id}/images?revision=${recipe.revision}`,
      ...multipart(png, "image/jpeg"),
    });
    assert.equal(spoof.statusCode, 400, spoof.body);
    const svg = await app.inject({
      method: "POST",
      url: `/api/v1/recipes/${id}/images?revision=${recipe.revision}`,
      ...multipart(Buffer.from("<svg/>"), "image/svg+xml"),
    });
    assert.equal(svg.statusCode, 415);
    const tooLarge = await app.inject({
      method: "POST",
      url: `/api/v1/recipes/${id}/images?revision=${recipe.revision}`,
      ...multipart(Buffer.alloc(8 * 1024 * 1024 + 1)),
    });
    assert.equal(tooLarge.statusCode, 413, tooLarge.body);
    assert.equal((await readdir(uploadDir)).length, 0);
    const file = await app.inject({
      method: "POST",
      url: `/api/v1/recipes/${id}/images?revision=${recipe.revision}`,
      ...multipart(png),
    });
    assert.equal(file.statusCode, 201, file.body);
    recipe = file.json().recipe;
    assert.equal(recipe.images.length, 1);
    assert.equal((await readdir(uploadDir)).length, 1);
    const image = await app.inject({
      method: "GET",
      url: recipe.images[0].url,
      headers: owner.headers,
    });
    assert.equal(image.statusCode, 200);
    assert.equal(image.headers["content-type"], "image/webp");
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: recipe.images[0].url,
          headers: outsider.headers,
        })
      ).statusCode,
      404,
    );
    const removed = await app.inject({
      method: "DELETE",
      url: `${recipe.images[0].url}?revision=${recipe.revision}`,
      headers: owner.headers,
    });
    assert.equal(removed.statusCode, 200, removed.body);
    recipe = removed.json().recipe;
    assert.equal((await readdir(uploadDir)).length, 0);
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/recipes/${id}?revision=${recipe.revision}`,
      headers: owner.headers,
    });
    assert.equal(deleted.statusCode, 200, deleted.body);
    recipe = deleted.json().recipe;
    assert.ok(recipe.deletedAt);
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/recipes/${id}`,
          headers: owner.headers,
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/recipes?householdId=${owner.householdId}&trash=true`,
          headers: owner.headers,
        })
      ).json().total,
      1,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/recipes/${id}/restore`,
          headers: viewer.headers,
          payload: { revision: recipe.revision },
        })
      ).statusCode,
      403,
    );
    const restore = await app.inject({
      method: "POST",
      url: `/api/v1/recipes/${id}/restore`,
      headers: owner.headers,
      payload: { revision: recipe.revision },
    });
    assert.equal(restore.statusCode, 200, restore.body);
    assert.equal(restore.json().recipe.deletedAt, null);
  } finally {
    await app.close();
    await db.$disconnect();
    await rm(uploadDir, { recursive: true, force: true });
  }
});
