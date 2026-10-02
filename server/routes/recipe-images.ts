import type { FastifyInstance, FastifyRequest } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeImage, imageFormats } from "../lib/normalize-image";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import type { Config } from "../lib/config";
import {
  readRecipe,
  recipeRow,
  lockRecipe,
  RecipeError,
} from "../services/recipes";
import { detailResponse, idParams, revisionQuery } from "../lib/recipe-schemas";
declare module "fastify" {
  interface FastifyContextConfig {
    imageUpload?: boolean;
  }
}
export async function imageRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  config: Config,
  userId: (request: FastifyRequest) => Promise<string>,
) {
  const secure = { tags: ["Recipe images"], security: [{ cookieAuth: [] }] };
  app.post<{ Params: { id: string }; Querystring: { revision: number } }>(
    "/recipes/:id/images",
    {
      bodyLimit: 9 * 1024 * 1024,
      config: {
        imageUpload: true,
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
      schema: {
        ...secure,
        params: idParams,
        querystring: revisionQuery,
        consumes: ["multipart/form-data"],
        response: { 201: detailResponse },
      },
    },
    async (request, reply) => {
      const actor = await userId(request);
      await recipeRow(db, actor, request.params.id, false, true);
      const part = await request.file({
        limits: { files: 1, fields: 0, parts: 1, fileSize: 8 * 1024 * 1024 },
      });
      if (!part) throw new RecipeError(400, "Bitte ein Bild auswählen.");
      if (!imageFormats[part.mimetype]) {
        part.file.resume();
        throw new RecipeError(415, "Erlaubt sind JPEG, PNG und WebP.");
      }
      const buffer = await part.toBuffer();
      const output = await normalizeImage(buffer, part.mimetype);
      const key = `${randomUUID()}.webp`;
      await mkdir(config.uploadDir, { recursive: true });
      const path = join(config.uploadDir, key);
      await writeFile(path, output, { flag: "wx", mode: 0o600 });
      try {
        const recipe = await db.$transaction(
          async (tx) => {
            await lockRecipe(tx, actor, request.params.id, false, true);
            const change = await tx.recipe.updateMany({
              where: {
                id: request.params.id,
                revision: request.query.revision,
                deletedAt: null,
              },
              data: { revision: { increment: 1 } },
            });
            if (!change.count)
              throw new RecipeError(
                409,
                "Das Rezept wurde inzwischen geändert. Bitte neu laden.",
              );
            if (
              (await tx.recipeImage.count({
                where: { recipeId: request.params.id },
              })) >= 8
            )
              throw new RecipeError(
                400,
                "Pro Rezept sind höchstens acht Bilder erlaubt.",
              );
            await tx.recipeImage.create({
              data: {
                recipeId: request.params.id,
                storageKey: key,
                bytes: output.length,
              },
            });
            return readRecipe(tx, actor, request.params.id);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
        return reply.code(201).send({ recipe });
      } catch (error) {
        await unlink(path).catch(() => {});
        throw error;
      }
    },
  );
  app.get<{ Params: { id: string; imageId: string } }>(
    "/recipes/:id/images/:imageId",
    {
      schema: {
        ...secure,
        params: {
          type: "object",
          required: ["id", "imageId"],
          properties: {
            id: { type: "string", maxLength: 30 },
            imageId: { type: "string", maxLength: 30 },
          },
        },
      },
    },
    async (request, reply) => {
      await recipeRow(db, await userId(request), request.params.id, true);
      const image = await db.recipeImage.findFirst({
        where: { id: request.params.imageId, recipeId: request.params.id },
      });
      if (!image) throw new RecipeError(404, "Bild nicht gefunden.");
      return reply
        .type("image/webp")
        .header("Content-Disposition", "inline")
        .send(createReadStream(join(config.uploadDir, image.storageKey)));
    },
  );
  app.delete<{
    Params: { id: string; imageId: string };
    Querystring: { revision: number };
  }>(
    "/recipes/:id/images/:imageId",
    {
      schema: {
        ...secure,
        params: {
          type: "object",
          required: ["id", "imageId"],
          properties: {
            id: { type: "string", maxLength: 30 },
            imageId: { type: "string", maxLength: 30 },
          },
        },
        querystring: revisionQuery,
        response: { 200: detailResponse },
      },
    },
    async (request) => {
      const actor = await userId(request);
      const { recipe, key } = await db.$transaction(
        async (tx) => {
          await lockRecipe(tx, actor, request.params.id, false, true);
          const image = await tx.recipeImage.findFirst({
            where: { id: request.params.imageId, recipeId: request.params.id },
          });
          if (!image) throw new RecipeError(404, "Bild nicht gefunden.");
          const change = await tx.recipe.updateMany({
            where: { id: request.params.id, revision: request.query.revision },
            data: { revision: { increment: 1 } },
          });
          if (!change.count)
            throw new RecipeError(
              409,
              "Das Rezept wurde inzwischen geändert. Bitte neu laden.",
            );
          await tx.recipeImage.delete({ where: { id: image.id } });
          return {
            recipe: await readRecipe(tx, actor, request.params.id),
            key: image.storageKey,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
      await unlink(join(config.uploadDir, key)).catch(() =>
        app.log.warn(
          "Nicht referenzierte Bilddatei konnte nicht entfernt werden.",
        ),
      );
      return { recipe };
    },
  );
}
