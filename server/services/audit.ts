import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "../lib/config";
import { authService } from "./auth";
export function installAudit(
  app: FastifyInstance,
  db: PrismaClient,
  config: Config,
) {
  const auth = authService(db, config),
    actors = new WeakMap<object, string>();
  app.addHook("preHandler", async (req) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    const user = await auth.currentUser(req);
    if (user) actors.set(req, user.id);
  });
  app.addHook("onResponse", async (req, reply) => {
    const actorId = actors.get(req);
    if (!actorId) return;
    const route = req.routeOptions.url;
    if (
      !route ||
      route.startsWith("/api/v1/admin/") ||
      route.endsWith("/preview") ||
      route.endsWith("/auth/reset/confirm")
    )
      return;
    const params = req.params as { id?: unknown };
    const targetId =
      typeof params?.id === "string" && params.id.length <= 30
        ? params.id
        : null;
    try {
      await db.auditEvent.create({
        data: {
          actorId,
          action: `${req.method} ${route}`.slice(0, 160),
          targetId,
          status: reply.statusCode,
        },
      });
    } catch {
      req.log.warn("Aktivität konnte nicht protokolliert werden.");
    }
  });
}
