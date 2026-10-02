import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "../lib/config";
import { RecipeError } from "../lib/errors";
import { validateDocument, validateRecipeInput } from "../lib/recipe-document";
import { normalizeImage } from "../lib/normalize-image";
import {
  recipeInput,
  recipeDocument,
  type RecipeDocument,
} from "../../shared/recipe-transfer";
import { deviceSignature } from "../../shared/devices";
import { lockHousehold } from "./household-access";
import { readRecipe, lockRecipe, saveRecipeTx, membership } from "./recipes";
const options = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  timeout: 30000,
  maxWait: 10000,
};
export async function exportRecipe(
  db: PrismaClient,
  userId: string,
  id: string,
  config: Config,
  images = true,
) {
  return db.$transaction(async (tx) => {
    const { row } = await lockRecipe(tx, userId, id);
    const recipe = await readRecipe(tx, userId, id);
    const data: string[] = [];
    let bytes = 0;
    if (images)
      for (const image of row.images) {
        const buffer = await readFile(join(config.uploadDir, image.storageKey));
        bytes += buffer.length;
        if (bytes > 16 * 1024 * 1024)
          throw new RecipeError(
            413,
            "Bilder zu groß. Export ohne Bilder auswählen.",
          );
        data.push(`data:image/webp;base64,${buffer.toString("base64")}`);
      }
    return recipeDocument(recipe, data);
  }, options);
}
export async function importDocument(
  db: PrismaClient,
  userId: string,
  document: RecipeDocument,
  householdId: string,
  visibility: "PRIVATE" | "HOUSEHOLD",
  config: Config,
) {
  validateDocument(document);
  const files: Array<{ key: string; buffer: Buffer }> = [];
  try {
    await membership(db, userId, householdId, true);
    for (const encoded of document.images) {
      const [prefix, base64] = encoded.split(",");
      const buffer = await normalizeImage(
        Buffer.from(base64, "base64"),
        prefix.slice(5).split(";")[0],
      );
      files.push({ key: `${randomUUID()}.webp`, buffer });
    }
    await mkdir(config.uploadDir, { recursive: true });
    for (const file of files)
      await writeFile(join(config.uploadDir, file.key), file.buffer, {
        flag: "wx",
        mode: 0o600,
      });
    const digest = createHash("sha256")
      .update(userId)
      .update(
        JSON.stringify({
          ...document,
          recipe: { ...recipeInput(document.recipe), householdId: "" },
        }),
      )
      .digest("hex");
    const result = await db.$transaction(async (tx) => {
      await lockHousehold(tx, householdId);
      await membership(tx, userId, householdId, true);
      const prior = await tx.importReceipt.findUnique({
        where: {
          householdId_kind_contentHash: {
            householdId,
            kind: "JSON",
            contentHash: digest,
          },
        },
      });
      if (prior)
        return {
          recipe: await readRecipe(tx, userId, prior.recipeId),
          created: false,
        };
      const recipe = await saveRecipeTx(tx, userId, {
        ...recipeInput(document.recipe),
        householdId,
        visibility,
      });
      await tx.importReceipt.create({
        data: {
          householdId,
          kind: "JSON",
          contentHash: digest,
          recipeId: recipe.id,
        },
      });
      for (const file of files)
        await tx.recipeImage.create({
          data: {
            recipeId: recipe.id,
            storageKey: file.key,
            bytes: file.buffer.length,
          },
        });
      for (const device of document.devices ?? [])
        await tx.deviceRecipeData.create({
          data: {
            recipeId: recipe.id,
            deviceKey: device.deviceKey,
            contentHash: createHash("sha256")
              .update(deviceSignature(recipe))
              .digest("hex"),
            data: device.steps as unknown as Prisma.InputJsonValue,
          },
        });
      return { recipe: await readRecipe(tx, userId, recipe.id), created: true };
    }, options);
    if (!result.created)
      await Promise.all(
        files.map((file) =>
          unlink(join(config.uploadDir, file.key)).catch(() => {}),
        ),
      );
    return result.recipe;
  } catch (error) {
    await Promise.all(
      files.map((file) =>
        unlink(join(config.uploadDir, file.key)).catch(() => {}),
      ),
    );
    throw error;
  }
}
export async function duplicateRecipe(
  db: PrismaClient,
  userId: string,
  id: string,
  config: Config,
) {
  const files: string[] = [];
  try {
    return await db.$transaction(async (tx) => {
      const { row } = await lockRecipe(tx, userId, id);
      await membership(tx, userId, row.householdId, true);
      const source = await readRecipe(tx, userId, id);
      const recipe = await saveRecipeTx(tx, userId, {
        ...recipeInput(source),
        title: `${source.title.slice(0, 188)} (Kopie)`,
        visibility: "PRIVATE",
      });
      await mkdir(config.uploadDir, { recursive: true });
      for (const image of row.images) {
        const data = await readFile(join(config.uploadDir, image.storageKey));
        const key = `${randomUUID()}.webp`;
        await writeFile(join(config.uploadDir, key), data, {
          flag: "wx",
          mode: 0o600,
        });
        files.push(key);
        await tx.recipeImage.create({
          data: { recipeId: recipe.id, storageKey: key, bytes: data.length },
        });
      }
      for (const device of source.deviceData.filter((data) => data.current))
        await tx.deviceRecipeData.create({
          data: {
            recipeId: recipe.id,
            deviceKey: device.deviceKey,
            contentHash: createHash("sha256")
              .update(deviceSignature(recipe))
              .digest("hex"),
            data: device.steps as unknown as Prisma.InputJsonValue,
          },
        });
      return readRecipe(tx, userId, recipe.id);
    }, options);
  } catch (error) {
    await Promise.all(
      files.map((key) => unlink(join(config.uploadDir, key)).catch(() => {})),
    );
    throw error;
  }
}
export async function versions(db: PrismaClient, userId: string, id: string) {
  return db.$transaction(
    async (tx) => {
      const recipe = await readRecipe(tx, userId, id);
      if (!recipe.canEdit)
        throw new RecipeError(
          403,
          "Versionshistorie benötigt Bearbeitungsrechte.",
        );
      return tx.recipeVersion.findMany({
        where: { recipeId: id },
        orderBy: { revision: "desc" },
        take: 100,
        select: {
          revision: true,
          createdAt: true,
          author: { select: { name: true } },
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function restoreVersion(
  db: PrismaClient,
  userId: string,
  id: string,
  version: number,
  revision: number,
) {
  return db.$transaction(async (tx) => {
    const { row } = await lockRecipe(tx, userId, id, false, true);
    const snapshot = await tx.recipeVersion.findUnique({
      where: { recipeId_revision: { recipeId: id, revision: version } },
    });
    if (!snapshot) throw new RecipeError(404, "Version nicht gefunden.");
    const data = recipeInput(
      snapshot.snapshot as unknown as import("../../shared/recipes").RecipeInput,
    );
    data.householdId = row.householdId;
    data.visibility = row.visibility;
    validateRecipeInput(data);
    return saveRecipeTx(tx, userId, data, id, revision);
  }, options);
}
