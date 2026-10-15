import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { createReadStream } from "node:fs";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Config } from "../lib/config";
import { authService } from "../services/auth";
import { accountRecovery } from "../services/account-recovery";
import { normalizeImage } from "../lib/normalize-image";
import { RecipeError } from "../lib/errors";
import { publicUser } from "../lib/schemas";
const object = (properties: object, required: string[]) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const bool = { type: "boolean" },
  id = { type: "string", minLength: 1, maxLength: 30 };
export async function accountRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  config: Config,
) {
  const auth = authService(db, config),
    recovery = accountRecovery(db, config);
  const user = async (req: FastifyRequest) => {
    const u = await auth.currentUser(req);
    if (!u) throw new RecipeError(401, "Bitte anmelden.");
    return u;
  };
  const admin = async (req: FastifyRequest) => {
    const u = await user(req);
    if (!u.isAdmin)
      throw new RecipeError(403, "Administratorrechte erforderlich.");
    return u;
  };
  app.addHook("onClose", async () => recovery.close());
  app.get("/auth/options", { schema: { tags: ["Auth"] } }, async () => ({
    passwordResetEnabled: !!config.smtp,
    oidcEnabled: !!config.oidc,
    oidcRegistrationEnabled: config.oidc?.registrationEnabled ?? false,
    oidcLabel: config.oidc?.label ?? "",
  }));
  app.post<{ Body: { email: string } }>(
    "/auth/reset/request",
    {
      config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
      schema: {
        tags: ["Auth"],
        body: object(
          { email: { type: "string", format: "email", maxLength: 254 } },
          ["email"],
        ),
      },
    },
    async (req) => {
      if ((await recovery.request(req.body.email)) === false)
        app.log.warn("SMTP-Zustellung fehlgeschlagen.");
      return {
        message:
          "Falls Konto und Mailzustellung verfügbar sind, erhältst du einen Reset-Link. / If the account and email delivery are available, you will receive a reset link.",
      };
    },
  );
  app.post<{ Body: { token: string; password: string } }>(
    "/auth/reset/confirm",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["Auth"],
        body: object(
          {
            token: { type: "string", pattern: "^[a-f0-9]{64}$" },
            password: { type: "string", minLength: 12, maxLength: 128 },
          },
          ["token", "password"],
        ),
      },
    },
    async (req) => {
      await recovery.reset(req.body.token, req.body.password);
      return { ok: true };
    },
  );
  app.get(
    "/auth/avatar/info",
    { schema: { tags: ["Profile"] } },
    async (req) => {
      const actor = await user(req),
        avatar = await db.profileAvatar.findUnique({
          where: { userId: actor.id },
        });
      return {
        url: avatar
          ? `/api/v1/auth/avatar?v=${avatar.updatedAt.getTime()}`
          : null,
      };
    },
  );
  app.get(
    "/auth/avatar",
    { schema: { tags: ["Profile"] } },
    async (req, reply) => {
      const actor = await user(req),
        avatar = await db.profileAvatar.findUnique({
          where: { userId: actor.id },
        });
      if (!avatar) throw new RecipeError(404, "Kein Profilbild.");
      reply.type("image/webp");
      return reply.send(
        createReadStream(join(config.uploadDir, avatar.storageKey)),
      );
    },
  );
  app.post(
    "/auth/avatar",
    {
      config: {
        imageUpload: true,
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
      schema: { tags: ["Profile"] },
      bodyLimit: 9 * 1024 * 1024,
    },
    async (req) => {
      const actor = await user(req),
        file = await req.file();
      if (!file) throw new RecipeError(400, "Bild fehlt.");
      const buffer = await file.toBuffer();
      if (file.file.truncated) throw new RecipeError(413, "Bild zu groß.");
      const normalized = await normalizeImage(buffer, file.mimetype),
        key = randomUUID() + ".webp";
      await mkdir(config.uploadDir, { recursive: true });
      await writeFile(join(config.uploadDir, key), normalized, {
        flag: "wx",
        mode: 0o600,
      });
      let old: string | undefined;
      try {
        await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM User WHERE id=${actor.id} FOR UPDATE`;
          old = (
            await tx.profileAvatar.findUnique({ where: { userId: actor.id } })
          )?.storageKey;
          await tx.profileAvatar.upsert({
            where: { userId: actor.id },
            create: { userId: actor.id, storageKey: key },
            update: { storageKey: key },
          });
        });
      } catch (e) {
        await unlink(join(config.uploadDir, key)).catch(() => {});
        throw e;
      }
      if (old) await unlink(join(config.uploadDir, old)).catch(() => {});
      return { ok: true };
    },
  );
  app.delete("/auth/avatar", { schema: { tags: ["Profile"] } }, async (req) => {
    const actor = await user(req);
    const old = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM User WHERE id=${actor.id} FOR UPDATE`;
      const record = await tx.profileAvatar.findUnique({
        where: { userId: actor.id },
      });
      await tx.profileAvatar.deleteMany({ where: { userId: actor.id } });
      return record;
    });
    if (old)
      await unlink(join(config.uploadDir, old.storageKey)).catch(() => {});
    return { ok: true };
  });
  app.get("/auth/activity", { schema: { tags: ["Profile"] } }, async (req) => ({
    events: await db.auditEvent.findMany({
      where: { actorId: (await user(req)).id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        action: true,
        targetId: true,
        status: true,
        createdAt: true,
      },
    }),
  }));
  app.get(
    "/admin/users",
    { schema: { tags: ["Administration"], security: [{ cookieAuth: [] }] } },
    async (req) => {
      await admin(req);
      const users = await db.user.findMany({
        orderBy: { createdAt: "asc" },
        take: 500,
        select: {
          ...publicUser,
          accountStatus: { select: { disabled: true } },
        },
      });
      return {
        users: users.map(({ accountStatus, ...u }) => ({
          ...u,
          disabled: accountStatus?.disabled ?? false,
        })),
      };
    },
  );
  app.patch<{
    Params: { id: string };
    Body: { disabled: boolean; isAdmin: boolean };
  }>(
    "/admin/users/:id",
    {
      schema: {
        tags: ["Administration"],
        params: object({ id }, ["id"]),
        body: object({ disabled: bool, isAdmin: bool }, [
          "disabled",
          "isAdmin",
        ]),
      },
    },
    async (req) => {
      const actor = await admin(req);
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM BootstrapLock WHERE id=1 FOR UPDATE`;
        const actorNow = await tx.user.findUnique({
          where: { id: actor.id },
          include: { accountStatus: true },
        });
        if (!actorNow?.isAdmin || actorNow.accountStatus?.disabled)
          throw new RecipeError(403, "Administratorrechte erforderlich.");
        const target = await tx.user.findUnique({
          where: { id: req.params.id },
        });
        if (!target) throw new RecipeError(404, "Konto nicht gefunden.");
        if (target.isAdmin && (req.body.disabled || !req.body.isAdmin)) {
          const others = await tx.user.count({
            where: {
              id: { not: target.id },
              isAdmin: true,
              OR: [
                { accountStatus: null },
                { accountStatus: { disabled: false } },
              ],
            },
          });
          if (!others)
            throw new RecipeError(
              409,
              "Der letzte aktive Administrator muss erhalten bleiben.",
            );
        }
        await tx.user.update({
          where: { id: target.id },
          data: { isAdmin: req.body.isAdmin },
        });
        await tx.accountStatus.upsert({
          where: { userId: target.id },
          create: { userId: target.id, disabled: req.body.disabled },
          update: { disabled: req.body.disabled },
        });
        await tx.session.deleteMany({ where: { userId: target.id } });
        await tx.auditEvent.create({
          data: {
            actorId: actor.id,
            action: "ADMIN ACCOUNT UPDATE",
            targetId: target.id,
            status: 200,
          },
        });
      });
      return { ok: true };
    },
  );
  app.get(
    "/admin/activity",
    { schema: { tags: ["Administration"] } },
    async (req) => {
      await admin(req);
      return {
        events: await db.auditEvent.findMany({
          orderBy: { createdAt: "desc" },
          take: 200,
          select: {
            id: true,
            actorId: true,
            action: true,
            targetId: true,
            status: true,
            createdAt: true,
            actor: { select: { name: true } },
          },
        }),
      };
    },
  );
}
