import test from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { buildApp } from "../../server/app";
import { readConfig } from "../../server/lib/config";
import { hashPassword, hashToken } from "../../server/lib/password";
import { emptyRecipe } from "../../shared/recipes";
import { recipeInput } from "../../shared/recipe-transfer";
import { suggestedDeviceSteps } from "../../shared/devices";
import { testZip, tandoorFixture } from "../helpers/zip";
import {
  createImportJob,
  changeImportJob,
  processNextImport,
  importJob,
} from "../../server/services/import-jobs";
if (
  !new URL(process.env.DATABASE_URL ?? "http://invalid").pathname.endsWith(
    "/rezeptdatenbank_test",
  )
)
  throw new Error("Disposable DB required");
test("file import, versions, devices and public links preserve privacy and are safely repeatable", async () => {
  const db = new PrismaClient();
  const uploadDir = await mkdtemp(join(tmpdir(), "recipe-files-"));
  const config = readConfig({
    ...process.env,
    APP_ORIGIN: "http://files.test",
    UPLOAD_DIR: uploadDir,
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
        email: `${randomBytes(10).toString("hex")}@files.test`,
        passwordHash: await hashPassword("files-password-long"),
        memberships: {
          create: {
            role,
            ...(householdId
              ? { household: { connect: { id: householdId } } }
              : { household: { create: { name: "Files test" } } }),
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
    viewer = await account("VIEWER", owner.householdId),
    editor = await account("EDITOR", owner.householdId),
    outsider = await account("OWNER");
  type Actor = typeof owner;
  async function request(
    actor: Actor,
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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
    const draft = {
      ...emptyRecipe(owner.householdId),
      title: "Original",
      visibility: "PRIVATE" as const,
      notes: "Hidden personal notes",
      ingredients: [
        { name: "Kartoffeln", amount: "500", unit: "g", group: "", note: "" },
      ],
      steps: [
        { instruction: "Kochen", durationSeconds: 5, ingredientIndexes: [0] },
      ],
      allergens: ["Milch"],
      nutrition: {
        calories: "123.45",
        carbohydrates: null,
        fats: null,
        proteins: null,
        basis: "SERVING" as const,
        source: "Manual",
      },
    };
    let recipe = (await request(owner, "POST", "/recipes", draft, 201)).recipe;
    await request(
      owner,
      "POST",
      "/recipes",
      { ...draft, steps: [{ ...draft.steps[0], ingredientIndexes: [5] }] },
      400,
    );
    await request(
      outsider,
      "GET",
      `/recipes/${recipe.id}/export`,
      undefined,
      404,
    );
    await request(viewer, "POST", `/recipes/${recipe.id}/duplicate`, {}, 404);
    recipe = (
      await request(owner, "PATCH", `/recipes/${recipe.id}`, {
        ...draft,
        title: "Changed",
        revision: recipe.revision,
        visibility: "HOUSEHOLD",
      })
    ).recipe;
    assert.equal(
      (await request(owner, "GET", `/recipes/${recipe.id}/versions`)).versions
        .length,
      1,
    );
    await request(
      viewer,
      "GET",
      `/recipes/${recipe.id}/versions`,
      undefined,
      403,
    );
    recipe = (
      await request(owner, "POST", `/recipes/${recipe.id}/versions/restore`, {
        version: 1,
        revision: recipe.revision,
      })
    ).recipe;
    assert.equal(recipe.title, "Original");
    assert.equal(recipe.visibility, "HOUSEHOLD");
    assert.equal(recipe.nutrition.calories, "123.45");
    assert.deepEqual(recipe.steps[0].ingredientIndexes, [0]);
    const device = suggestedDeviceSteps(recipe);
    device[0] = { ...device[0], enabled: true, speed: 5 };
    await request(
      owner,
      "PUT",
      `/recipes/${recipe.id}/devices/thermomix-tm6`,
      { revision: recipe.revision, confirmed: false, steps: device },
      400,
    );
    await request(
      viewer,
      "PUT",
      `/recipes/${recipe.id}/devices/thermomix-tm6`,
      { revision: recipe.revision, confirmed: true, steps: device },
      403,
    );
    recipe = (
      await request(
        owner,
        "PUT",
        `/recipes/${recipe.id}/devices/thermomix-tm6`,
        { revision: recipe.revision, confirmed: true, steps: device },
      )
    ).recipe;
    assert.equal(recipe.deviceData[0].current, true);
    await request(
      owner,
      "GET",
      `/recipes/${recipe.id}/devices/thermomix-tm6/export`,
    );
    assert.equal(
      (
        await request(
          owner,
          "GET",
          `/recipes?householdId=${owner.householdId}&thermomix=true`,
        )
      ).total,
      1,
    );
    await request(owner, "PUT", `/recipes/${recipe.id}/rating`, { rating: 4 });
    assert.equal(
      (
        await request(
          owner,
          "GET",
          `/recipes?householdId=${owner.householdId}&minRating=4`,
        )
      ).total,
      1,
    );
    const pantry = await request(
      owner,
      "GET",
      `/recipes?householdId=${owner.householdId}&availableIngredients=Eier&maxMissing=1`,
    );
    assert.deepEqual(pantry.recipes[0].missingIngredients, ["Kartoffeln"]);
    assert.equal(
      (
        await request(
          owner,
          "GET",
          `/recipes?householdId=${owner.householdId}&availableIngredients=Eier&maxMissing=0`,
        )
      ).total,
      0,
    );
    await request(
      editor,
      "POST",
      `/recipes/${recipe.id}/share-links`,
      { days: 30, revision: recipe.revision },
      403,
    );
    const share = await request(
      owner,
      "POST",
      `/recipes/${recipe.id}/share-links`,
      { days: 30, revision: recipe.revision },
    );
    const token = share.url.split("/").pop();
    let publicResponse = await app.inject({
      method: "GET",
      url: `/api/v1/public-recipes/${token}`,
    });
    assert.equal(publicResponse.statusCode, 200, publicResponse.body);
    assert.ok(!publicResponse.body.includes("Hidden personal"));
    assert.ok(!publicResponse.body.includes(owner.id));
    assert.equal(publicResponse.json().schemaOrg["@type"], "Recipe");
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/public-recipes/${token}/qr`,
        })
      ).statusCode,
      200,
    );
    await request(
      owner,
      "DELETE",
      `/recipes/${recipe.id}/share-links/${share.id}`,
    );
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/public-recipes/${token}`,
        })
      ).statusCode,
      404,
    );
    const image = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "red" },
    })
      .webp()
      .toBuffer();
    const form = Buffer.concat([
      Buffer.from(
        '--files\r\nContent-Disposition: form-data; name="file"; filename="test.webp"\r\nContent-Type: image/webp\r\n\r\n',
      ),
      image,
      Buffer.from("\r\n--files--\r\n"),
    ]);
    const uploaded = await app.inject({
      method: "POST",
      url: `/api/v1/recipes/${recipe.id}/images?revision=${recipe.revision}`,
      headers: {
        ...owner.headers,
        "content-type": "multipart/form-data; boundary=files",
      },
      payload: form,
    });
    assert.equal(uploaded.statusCode, 201, uploaded.body);
    recipe = uploaded.json().recipe;
    const exported = await request(
      owner,
      "GET",
      `/recipes/${recipe.id}/export`,
    );
    assert.equal(exported.images.length, 1);
    assert.equal(exported.devices.length, 1);
    const duplicate = (
      await request(editor, "POST", `/recipes/${recipe.id}/duplicate`, {}, 201)
    ).recipe;
    assert.equal(duplicate.visibility, "PRIVATE");
    assert.equal(duplicate.images.length, 1);
    const imported = (
      await request(
        owner,
        "POST",
        "/recipe-imports/json",
        {
          householdId: owner.householdId,
          visibility: "PRIVATE",
          document: exported,
        },
        201,
      )
    ).recipe;
    const repeated = (
      await request(
        owner,
        "POST",
        "/recipe-imports/json",
        {
          householdId: owner.householdId,
          visibility: "PRIVATE",
          document: exported,
        },
        201,
      )
    ).recipe;
    assert.equal(imported.id, repeated.id);
    const before = await db.recipe.count();
    await request(
      owner,
      "POST",
      "/recipe-imports/json",
      {
        householdId: owner.householdId,
        visibility: "PRIVATE",
        document: {
          ...exported,
          images: ["data:image/webp;base64,aW52YWxpZA=="],
        },
      },
      400,
    );
    assert.equal(await db.recipe.count(), before);
    recipe = (
      await request(owner, "PATCH", `/recipes/${recipe.id}`, {
        ...recipeInput(recipe),
        servings: 6,
        revision: recipe.revision,
      })
    ).recipe;
    assert.equal(recipe.deviceData[0].current, false);
    await request(
      owner,
      "GET",
      `/recipes/${recipe.id}/devices/thermomix-tm6/export`,
      undefined,
      409,
    );
    assert.equal(
      (
        await request(
          owner,
          "GET",
          `/recipes?householdId=${owner.householdId}&thermomix=true`,
        )
      ).total,
      1,
    );
    const archive = testZip({
      "1.zip": testZip({
        "recipe.json": JSON.stringify(tandoorFixture),
        "image.webp": image,
      }),
      "2.zip": testZip({ "recipe.json": "invalid" }),
      "3.zip": testZip({
        "recipe.json": JSON.stringify({
          ...tandoorFixture,
          name: "Other recipe",
        }),
        "image.png": "invalid image",
      }),
    });
    const book = (
      await request(owner, "POST", "/cookbooks", {
        householdId: owner.householdId,
        name: "Import",
        description: "",
      })
    ).cookbook;
    const job = await createImportJob(
      db,
      owner.id,
      owner.householdId,
      archive,
      config,
    );
    await request(
      editor,
      "GET",
      `/recipe-imports/tandoor/${job.id}`,
      undefined,
      404,
    );
    await changeImportJob(
      db,
      owner.id,
      job.id,
      "START",
      config,
      "PRIVATE",
      book.id,
    );
    await Promise.all([
      processNextImport(db, config),
      processNextImport(db, config),
    ]);
    const report = await importJob(db, owner.id, job.id);
    assert.equal(report.status, "COMPLETED");
    assert.equal(
      report.results.filter((r) => r.status === "CREATED").length,
      2,
    );
    assert.equal(report.results.filter((r) => r.status === "FAILED").length, 1);
    assert.ok(
      report.results
        .find((r) => r.title === "Other recipe")
        ?.message.includes("Bild"),
    );
    const count = await db.recipe.count();
    const again = await createImportJob(
      db,
      owner.id,
      owner.householdId,
      archive,
      config,
    );
    await changeImportJob(
      db,
      owner.id,
      again.id,
      "START",
      config,
      "PRIVATE",
      null,
    );
    await processNextImport(db, config);
    assert.equal(await db.recipe.count(), count);
    assert.equal(
      (await importJob(db, owner.id, again.id)).results.filter(
        (r) => r.status === "SKIPPED",
      ).length,
      2,
    );
    const share2 = await request(
      owner,
      "POST",
      `/recipes/${recipe.id}/share-links`,
      { days: 1, revision: recipe.revision },
    );
    const token2 = share2.url.split("/").pop();
    await db.householdMember.delete({
      where: {
        householdId_userId: {
          householdId: owner.householdId,
          userId: owner.id,
        },
      },
    });
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/public-recipes/${token2}`,
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (await readdir(uploadDir)).filter((name) => name.endsWith(".webp"))
        .length,
      await db.recipeImage.count({
        where: { recipe: { householdId: owner.householdId } },
      }),
    );
  } finally {
    await app.close();
    await db.$disconnect();
    await rm(uploadDir, { recursive: true, force: true });
  }
});
