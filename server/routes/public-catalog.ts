import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import type { Config } from "../lib/config";
import { RecipeError } from "../lib/errors";
import { authService } from "../services/auth";
import * as service from "../services/public-catalog";
export async function publicCatalogRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  config: Config,
) {
  const auth = authService(db, config),
    user = async (request: FastifyRequest) => {
      const actor = await auth.currentUser(request);
      if (!actor) throw new RecipeError(401, "Bitte anmelden.");
      return actor.id;
    };
  const id = { type: "string", minLength: 1, maxLength: 30 },
    params = { type: "object", required: ["id"], properties: { id } },
    secure = { tags: ["Public catalog"], security: [{ cookieAuth: [] }] };
  app.get<{ Params: { id: string } }>(
    "/recipes/:id/publication",
    { schema: { ...secure, params } },
    async (request) => ({
      publication: await service.publication(
        db,
        await user(request),
        request.params.id,
        config,
      ),
    }),
  );
  app.put<{
    Params: { id: string };
    Body: {
      published: boolean;
      recipeRevision: number;
      revision: number;
      confirmedPublic?: boolean;
    };
  }>(
    "/recipes/:id/publication",
    {
      schema: {
        ...secure,
        params,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["published", "recipeRevision", "revision"],
          properties: {
            published: { type: "boolean" },
            recipeRevision: { type: "integer", minimum: 1 },
            revision: { type: "integer", minimum: 0 },
            confirmedPublic: { type: "boolean" },
          },
        },
      },
    },
    async (request) => ({
      publication: await service.changePublication(
        db,
        await user(request),
        request.params.id,
        request.body,
        config,
      ),
    }),
  );
  app.get<{
    Querystring: {
      q?: string;
      page?: number;
      pageSize?: number;
      diet?: string;
    };
  }>(
    "/catalog/recipes",
    {
      schema: {
        tags: ["Public catalog"],
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            q: { type: "string", maxLength: 200 },
            page: { type: "integer", minimum: 1, maximum: 100000 },
            pageSize: { type: "integer", minimum: 1, maximum: 48 },
            diet: { type: "string", enum: ["all", "vegetarian", "vegan"] },
          },
        },
      },
    },
    async (request) => service.catalog(db, request.query, config),
  );
  app.get<{ Params: { id: string } }>(
    "/catalog/recipes/:id",
    { schema: { tags: ["Public catalog"], params } },
    async (request) => service.catalogRecipe(db, request.params.id, config),
  );
  app.get<{ Params: { id: string; imageId: string } }>(
    "/catalog/recipes/:id/images/:imageId",
    {
      schema: {
        tags: ["Public catalog"],
        params: {
          type: "object",
          required: ["id", "imageId"],
          properties: { id, imageId: id },
        },
      },
    },
    async (request, reply) => {
      const { recipe } = await service.catalogRecipe(
        db,
        request.params.id,
        config,
      );
      if (!recipe.images.some((i) => i.id === request.params.imageId))
        throw new RecipeError(404, "Bild nicht gefunden.");
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
