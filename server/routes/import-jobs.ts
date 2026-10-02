import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "../lib/config";
import { authService } from "../services/auth";
import { RecipeError } from "../lib/errors";
import { membership } from "../services/household-access";
import * as service from "../services/import-jobs";
declare module "fastify" {
  interface FastifyContextConfig {
    archiveUpload?: boolean;
  }
}
const id = { type: "string", minLength: 1, maxLength: 30 };
export async function importJobRoutes(
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
    tags: ["Tandoor import jobs"],
    security: [{ cookieAuth: [] }],
  };
  let previewing = false;
  app.post<{ Querystring: { householdId: string } }>(
    "/recipe-imports/tandoor",
    {
      bodyLimit: 65 * 1024 * 1024,
      config: {
        archiveUpload: true,
        rateLimit: { max: 2, timeWindow: "1 minute" },
      },
      schema: {
        ...secure,
        querystring: {
          type: "object",
          required: ["householdId"],
          additionalProperties: false,
          properties: { householdId: id },
        },
        consumes: ["multipart/form-data"],
        response: { 200: { type: "object", additionalProperties: true } },
      },
    },
    async (request) => {
      const actor = await user(request);
      await membership(db, actor, request.query.householdId, true);
      if (previewing)
        throw new RecipeError(
          429,
          "Eine Archivvorschau läuft bereits. Bitte kurz warten.",
        );
      previewing = true;
      try {
        const part = await request.file({
          limits: { files: 1, fields: 0, parts: 1, fileSize: 64 * 1024 * 1024 },
        });
        if (!part)
          throw new RecipeError(400, "Bitte den Default-ZIP-Export auswählen.");
        if (
          ![
            "application/zip",
            "application/x-zip-compressed",
            "application/octet-stream",
          ].includes(part.mimetype)
        ) {
          part.file.resume();
          throw new RecipeError(415, "ZIP-Datei erforderlich.");
        }
        return await service.createImportJob(
          db,
          actor,
          request.query.householdId,
          await part.toBuffer(),
          config,
        );
      } finally {
        previewing = false;
      }
    },
  );
  app.get<{ Querystring: { householdId: string } }>(
    "/recipe-imports/tandoor",
    {
      schema: {
        ...secure,
        querystring: {
          type: "object",
          required: ["householdId"],
          properties: { householdId: id },
        },
      },
    },
    async (request) => ({
      jobs: await service.importJobs(
        db,
        await user(request),
        request.query.householdId,
      ),
    }),
  );
  app.get<{ Params: { id: string } }>(
    "/recipe-imports/tandoor/:id",
    {
      schema: {
        ...secure,
        params: { type: "object", required: ["id"], properties: { id } },
      },
    },
    async (request) =>
      service.importJob(db, await user(request), request.params.id),
  );
  app.post<{
    Params: { id: string };
    Body: { visibility: "PRIVATE" | "HOUSEHOLD"; targetBookId: string | null };
  }>(
    "/recipe-imports/tandoor/:id/start",
    {
      schema: {
        ...secure,
        params: { type: "object", required: ["id"], properties: { id } },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["visibility", "targetBookId"],
          properties: {
            visibility: { type: "string", enum: ["PRIVATE", "HOUSEHOLD"] },
            targetBookId: { anyOf: [id, { type: "null" }] },
          },
        },
      },
    },
    async (request) => {
      await service.changeImportJob(
        db,
        await user(request),
        request.params.id,
        "START",
        config,
        request.body.visibility,
        request.body.targetBookId,
      );
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/recipe-imports/tandoor/:id/cancel",
    {
      schema: {
        ...secure,
        params: { type: "object", required: ["id"], properties: { id } },
      },
    },
    async (request) => {
      await service.changeImportJob(
        db,
        await user(request),
        request.params.id,
        "CANCEL",
        config,
      );
      return { ok: true };
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/recipe-imports/tandoor/:id",
    {
      schema: {
        ...secure,
        params: { type: "object", required: ["id"], properties: { id } },
      },
    },
    async (request) => {
      await service.changeImportJob(
        db,
        await user(request),
        request.params.id,
        "DELETE",
        config,
      );
      return { ok: true };
    },
  );
}
