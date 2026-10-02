import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
import type { Config } from "../lib/config";
import { RecipeError } from "../lib/errors";
import { authService } from "../services/auth";
import * as service from "../services/public-recipes";
export async function publicRecipeRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  config: Config,
) {
  const auth = authService(db, config);
  const user = async (request: FastifyRequest) => {
    const actor = await auth.currentUser(request);
    if (!actor) throw new RecipeError(401, "Bitte anmelden.");
    return actor.id;
  };
  const id = { type: "string", minLength: 1, maxLength: 30 };
  const params = { type: "object", required: ["id"], properties: { id } };
  const secure = {
    tags: ["Public share links"],
    security: [{ cookieAuth: [] }],
  };
  app.get<{ Params: { id: string } }>(
    "/recipes/:id/share-links",
    { schema: { ...secure, params } },
    async (request) => ({
      links: await service.shareLinks(
        db,
        await user(request),
        request.params.id,
      ),
    }),
  );
  app.post<{
    Params: { id: string };
    Body: { days: number; revision: number };
  }>(
    "/recipes/:id/share-links",
    {
      schema: {
        ...secure,
        params,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["days", "revision"],
          properties: {
            days: { type: "integer", minimum: 1, maximum: 365 },
            revision: { type: "integer", minimum: 1 },
          },
        },
      },
    },
    async (request) =>
      service.createShare(
        db,
        await user(request),
        request.params.id,
        request.body.days,
        request.body.revision,
        config,
      ),
  );
  app.delete<{ Params: { id: string; linkId: string } }>(
    "/recipes/:id/share-links/:linkId",
    {
      schema: {
        ...secure,
        params: {
          type: "object",
          required: ["id", "linkId"],
          properties: { id, linkId: id },
        },
      },
    },
    async (request) => {
      await service.revokeShare(
        db,
        await user(request),
        request.params.id,
        request.params.linkId,
      );
      return { ok: true };
    },
  );
  const token = {
    type: "string",
    pattern: "^[a-f0-9]{64}$",
    minLength: 64,
    maxLength: 64,
  };
  const publicParams = {
    type: "object",
    required: ["token"],
    properties: { token },
  };
  const publicSchema = { tags: ["Public recipes"], params: publicParams };
  app.get<{ Params: { token: string } }>(
    "/public-recipes/:token",
    { schema: publicSchema },
    async (request) => service.publicRecipe(db, request.params.token, config),
  );
  app.get<{ Params: { token: string } }>(
    "/public-recipes/:token/qr",
    { schema: publicSchema },
    async (request, reply) => {
      await service.publicRecipe(db, request.params.token, config);
      return reply
        .type("image/svg+xml")
        .header("Referrer-Policy", "no-referrer")
        .send(
          await QRCode.toString(`${config.origin}/r/${request.params.token}`, {
            type: "svg",
            width: 256,
            margin: 2,
            errorCorrectionLevel: "M",
          }),
        );
    },
  );
  app.get<{ Params: { token: string; imageId: string } }>(
    "/public-recipes/:token/images/:imageId",
    {
      schema: {
        tags: ["Public recipes"],
        params: {
          type: "object",
          required: ["token", "imageId"],
          properties: { token, imageId: id },
        },
      },
    },
    async (request, reply) => {
      const { recipe } = await service.publicRecipe(
        db,
        request.params.token,
        config,
      );
      const image = await db.recipeImage.findFirst({
        where: { id: request.params.imageId, recipeId: recipe.id },
      });
      if (!image) throw new RecipeError(404, "Bild nicht gefunden.");
      return reply
        .type("image/webp")
        .header("Referrer-Policy", "no-referrer")
        .send(createReadStream(join(config.uploadDir, image.storageKey)));
    },
  );
}
