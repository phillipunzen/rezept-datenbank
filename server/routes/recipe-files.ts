import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "../lib/config";
import { authService } from "../services/auth";
import { RecipeError } from "../lib/errors";
import { idParams, detailResponse, recipeBody } from "../lib/recipe-schemas";
import { validateDocument } from "../lib/recipe-document";
import type { RecipeDocument } from "../../shared/recipe-transfer";
import * as service from "../services/recipe-files";
export async function recipeFileRoutes(
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
  const secure = {
    tags: ["Recipe files and versions"],
    security: [{ cookieAuth: [] }],
  };
  app.get<{ Params: { id: string }; Querystring: { images?: boolean } }>(
    "/recipes/:id/export",
    {
      schema: {
        ...secure,
        params: idParams,
        querystring: {
          type: "object",
          properties: { images: { type: "boolean" } },
        },
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request) =>
      service.exportRecipe(
        db,
        await user(request),
        request.params.id,
        config,
        request.query.images !== false,
      ),
  );
  app.post<{ Params: { id: string } }>(
    "/recipes/:id/duplicate",
    {
      schema: {
        ...secure,
        params: idParams,
        response: { 201: detailResponse },
      },
    },
    async (request, reply) =>
      reply.code(201).send({
        recipe: await service.duplicateRecipe(
          db,
          await user(request),
          request.params.id,
          config,
        ),
      }),
  );
  app.get<{ Params: { id: string } }>(
    "/recipes/:id/versions",
    {
      schema: {
        ...secure,
        params: idParams,
        response: {
          200: {
            type: "object",
            properties: {
              versions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    revision: { type: "integer" },
                    createdAt: { type: "string", format: "date-time" },
                    author: {
                      type: "object",
                      properties: { name: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request) => ({
      versions: await service.versions(
        db,
        await user(request),
        request.params.id,
      ),
    }),
  );
  app.post<{
    Params: { id: string };
    Body: { version: number; revision: number };
  }>(
    "/recipes/:id/versions/restore",
    {
      schema: {
        ...secure,
        params: idParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["version", "revision"],
          properties: {
            version: { type: "integer", minimum: 1 },
            revision: { type: "integer", minimum: 1 },
          },
        },
        response: { 200: detailResponse },
      },
    },
    async (request) => ({
      recipe: await service.restoreVersion(
        db,
        await user(request),
        request.params.id,
        request.body.version,
        request.body.revision,
      ),
    }),
  );
  app.post<{
    Body: {
      householdId: string;
      visibility: "PRIVATE" | "HOUSEHOLD";
      document: RecipeDocument;
    };
  }>(
    "/recipe-imports/json",
    {
      bodyLimit: 24 * 1024 * 1024,
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        ...secure,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["householdId", "visibility", "document"],
          properties: {
            householdId: { type: "string", minLength: 1, maxLength: 30 },
            visibility: { type: "string", enum: ["PRIVATE", "HOUSEHOLD"] },
            document: { type: "object", additionalProperties: true },
          },
        },
        response: { 201: detailResponse },
      },
    },
    async (request, reply) =>
      reply.code(201).send({
        recipe: await service.importDocument(
          db,
          await user(request),
          request.body.document,
          request.body.householdId,
          request.body.visibility,
          config,
        ),
      }),
  );
  app.post<{ Body: { document: unknown } }>(
    "/recipe-imports/json/preview",
    {
      bodyLimit: 24 * 1024 * 1024,
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        ...secure,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["document"],
          properties: {
            document: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    async (request) => {
      await user(request);
      validateDocument(request.body.document);
      return { document: request.body.document };
    },
  );
}
