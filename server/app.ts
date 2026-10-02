import { publicCatalogRoutes } from "./routes/public-catalog";
import { cookidooRoutes } from "./routes/cookidoo";
import { accountRoutes } from "./routes/accounts";
import { oidcRoutes } from "./routes/oidc";
import { installAudit } from "./services/audit";
import Fastify, { type FastifyError } from "fastify";
import multipart from "@fastify/multipart";
import { deviceRoutes } from "./routes/devices";
import { publicRecipeRoutes } from "./routes/public-recipes";
import { importJobRoutes } from "./routes/import-jobs";
import { recipeFileRoutes } from "./routes/recipe-files";
import { recipeRoutes } from "./routes/recipes";
import { RecipeError } from "./services/recipes";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "./lib/config";
import { authRoutes } from "./routes/auth";
import { planningRoutes } from "./routes/planning";
import { householdRoutes } from "./routes/households";
import type { RemoteFetcher } from "./lib/safe-fetch";
export async function buildApp(
  db: PrismaClient,
  config: Config,
  options: {
    recipeFetcher?: RemoteFetcher;
    cookidooProvider?: import("./integrations/cookidoo-provider").CookidooProvider;
    oidcFetch?: import("openid-client").CustomFetch;
  } = {},
) {
  const app = Fastify({
    bodyLimit: 32 * 1024,
    trustProxy: config.trustProxy,
    logger: {
      level: config.logLevel,
      redact: [
        "req.url",
        "req.headers.referer",
        "req.headers.cookie",
        "req.headers.authorization",
        "req.body",
        "res.headers.set-cookie",
      ],
    },
  });
  await app.register(cookie);
  installAudit(app, db, config);
  await app.register(multipart, {
    limits: { files: 1, fields: 0, parts: 1, fileSize: 8 * 1024 * 1024 },
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 150, timeWindow: "1 minute" });
  await app.register(swagger, {
    transformObject: (document) => {
      if ("openapiObject" in document) {
        for (const path of [
          "/api/v1/recipes/{id}/images",
          "/api/v1/recipe-imports/tandoor",
          "/api/v1/auth/avatar",
        ]) {
          const upload = document.openapiObject.paths?.[path]?.post;
          if (upload)
            upload.requestBody = {
              required: true,
              content: {
                "multipart/form-data": {
                  schema: {
                    type: "object",
                    required: ["file"],
                    properties: { file: { type: "string", format: "binary" } },
                  },
                },
              },
            };
        }
      }
      return "openapiObject" in document
        ? document.openapiObject
        : document.swaggerObject;
    },
    openapi: {
      info: {
        title: "Rezeptdatenbank API",
        version: "0.8.0",
        description:
          "Recipes, file imports, public sharing, devices, household planning and authentication.",
      },
      servers: [{ url: "/" }],
      components: {
        securitySchemes: {
          cookieAuth: { type: "apiKey", in: "cookie", name: "session" },
        },
      },
    },
  });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      if (request.headers.origin !== config.origin)
        return reply.code(403).send({
          message:
            "Ungültige Anfrageherkunft. Origin muss APP_ORIGIN entsprechen.",
        });
      if (
        request.headers["content-type"] &&
        !request.headers["content-type"].startsWith("application/json") &&
        !(
          (request.routeOptions.config.imageUpload ||
            request.routeOptions.config.archiveUpload) &&
          request.headers["content-type"].startsWith("multipart/form-data;")
        )
      )
        return reply
          .code(415)
          .send({ message: "Nur application/json ist erlaubt." });
    }
  });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const status =
      error.code === "P2034"
        ? 409
        : error.statusCode && error.statusCode < 500
          ? error.statusCode
          : 500;
    if (status >= 500)
      request.log.error(
        { code: error.code, type: error.name },
        "Anfrage fehlgeschlagen",
      );
    reply.code(status).send({
      message:
        error.code === "P2034"
          ? "Das Rezept wurde parallel geändert. Bitte neu laden und erneut versuchen."
          : error instanceof RecipeError
            ? error.message
            : status === 400
              ? "Eingaben ungültig. Bitte Felder und zulässige Werte prüfen."
              : status === 429
                ? "Zu viele Anfragen. Bitte kurz warten."
                : status === 413
                  ? "Die Datei oder Anfrage ist zu groß."
                  : status === 415
                    ? "Nicht unterstützter Dateityp."
                    : "Anfrage fehlgeschlagen.",
    });
  });
  await app.register(
    async (api) => {
      api.get("/health/live", { schema: { tags: ["System"] } }, async () => ({
        status: "ok",
      }));
      api.get(
        "/health/ready",
        { schema: { tags: ["System"] } },
        async (_request, reply) => {
          try {
            await db.$queryRaw`SELECT 1`;
            return { status: "ok", database: "connected" };
          } catch {
            return reply
              .code(503)
              .send({ status: "unavailable", database: "disconnected" });
          }
        },
      );
      api.get("/system", { schema: { tags: ["System"] } }, async () => ({
        version: "0.8.0",
        setupRequired: !(await db.bootstrapLock.findUnique({
          where: { id: 1 },
        })),
        registrationEnabled: config.registrationEnabled,
        publicCatalogEnabled: config.publicCatalogEnabled,
        phase: 8,
      }));
      await authRoutes(api, db, config);
      await accountRoutes(api, db, config);
      await oidcRoutes(api, db, config, options.oidcFetch);
      await householdRoutes(api, db, config);
      await planningRoutes(api, db, config);
      await cookidooRoutes(api, db, config, options.cookidooProvider);
      await recipeRoutes(api, db, config, options.recipeFetcher);
      await recipeFileRoutes(api, db, config);
      await importJobRoutes(api, db, config);
      await publicRecipeRoutes(api, db, config);
      await publicCatalogRoutes(api, db, config);
      await deviceRoutes(api, db, config);
      await api.register(swaggerUi, {
        routePrefix: "/docs",
        uiConfig: { docExpansion: "list" },
      });
    },
    { prefix: "/api/v1" },
  );
  return app;
}
