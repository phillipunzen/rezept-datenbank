import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "../lib/config";
import { authService } from "../services/auth";
import { RecipeError } from "../lib/errors";
import { cookidooSync } from "../services/cookidoo-sync";
import type { CookidooProvider } from "../integrations/cookidoo-provider";
const text = (maxLength: number) => ({
  type: "string",
  minLength: 1,
  maxLength,
});
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const revision = { type: "integer", minimum: 1 },
  consent = { type: "boolean", const: true };
export async function cookidooRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  config: Config,
  provider?: CookidooProvider,
) {
  const auth = authService(db, config),
    service = cookidooSync(db, config, provider);
  async function user(request: FastifyRequest) {
    const actor = await auth.currentUser(request);
    if (!actor) throw new RecipeError(401, "Bitte anmelden.");
    if (!config.cookidooEnabled)
      throw new RecipeError(404, "Cookidoo ist nicht aktiviert.");
    return actor.id;
  }
  const schema = { tags: ["Cookidoo"], security: [{ cookieAuth: [] }] };
  app.get("/cookidoo/options", { schema }, async (request) => {
    const actor = await auth.currentUser(request);
    if (!actor) throw new RecipeError(401, "Bitte anmelden.");
    return {
      enabled: config.cookidooEnabled,
      allowHttp: config.cookidooAllowHttp,
      secureOrigin: config.origin.startsWith("https://"),
    };
  });
  app.get("/cookidoo", { schema }, async (request) => ({
    connection: await service.get(await user(request)),
  }));
  app.post<{
    Body: {
      householdId: string;
      listId: string;
      email: string;
      password: string;
      market: string;
      confirmedSharing: true;
      confirmedHttp: true;
    };
  }>(
    "/cookidoo/connect",
    {
      config: { rateLimit: { max: 4, timeWindow: "1 minute" } },
      schema: {
        ...schema,
        body: object({
          householdId: text(30),
          listId: text(30),
          email: { ...text(254), format: "email" },
          password: text(128),
          market: { type: "string", enum: ["de", "at", "ch", "gb"] },
          confirmedSharing: consent,
          confirmedHttp: consent,
        }),
      },
    },
    async (request) => {
      const actor = await user(request);
      if (!config.origin.startsWith("https://") && !config.cookidooAllowHttp)
        throw new RecipeError(
          400,
          "Cookidoo-Anmeldung benötigt HTTPS.",
        );
      return { connection: await service.connect(actor, request.body) };
    },
  );
  app.patch<{
    Body: { paused: boolean; revision: number; confirmedBidirectional: true };
  }>(
    "/cookidoo",
    {
      schema: {
        ...schema,
        body: object({
          paused: { type: "boolean" },
          revision,
          confirmedBidirectional: consent,
        }),
      },
    },
    async (request) => {
      const actor = await user(request);
      await service.activate(actor, request.body.paused, request.body.revision);
      return { connection: await service.get(actor) };
    },
  );
  app.post("/cookidoo/sync", { schema }, async (request) => {
    const actor = await user(request);
    await service.sync(actor);
    return { connection: await service.get(actor) };
  });
  app.post<{
    Body: {
      conflictId: string;
      choice: "LOCAL" | "REMOTE" | "UNLINK";
      revision: number;
    };
  }>(
    "/cookidoo/resolve",
    {
      schema: {
        ...schema,
        body: object({
          conflictId: text(300),
          choice: { type: "string", enum: ["LOCAL", "REMOTE", "UNLINK"] },
          revision,
        }),
      },
    },
    async (request) => {
      const actor = await user(request);
      await service.resolve(
        actor,
        request.body.conflictId,
        request.body.choice,
        request.body.revision,
      );
      return { connection: await service.get(actor) };
    },
  );
  app.delete("/cookidoo", { schema }, async (request) => {
    await service.disconnect(await user(request));
    return { ok: true };
  });
}
