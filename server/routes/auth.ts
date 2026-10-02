import type { FastifyInstance } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { Config } from "../lib/config";
import { hashPassword, verifyPassword, safeTokenEqual } from "../lib/password";
import {
  credentials,
  setup,
  registration,
  profile,
  changePassword,
  publicUser,
} from "../lib/schemas";
import { authService } from "../services/auth";
type RegisterBody = {
  email: string;
  password: string;
  name: string;
  householdName?: string;
};
export async function authRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  config: Config,
) {
  const auth = authService(db, config);
  const authLimit = { rateLimit: { max: 10, timeWindow: "1 minute" } };
  // A valid dummy hash keeps unknown-account logins on the same password-hash path.
  const dummyHash = await hashPassword("unused-dummy-password-42");
  async function createAccount(body: RegisterBody, admin: boolean) {
    const passwordHash = await hashPassword(body.password);
    return db.$transaction(async (tx) => {
      if (admin) await tx.bootstrapLock.create({ data: { id: 1 } });
      return tx.user.create({
        data: {
          email: body.email.toLowerCase().trim(),
          name: body.name.trim(),
          passwordHash,
          isAdmin: admin,
          memberships: {
            create: {
              role: "OWNER",
              household: {
                create: { name: body.householdName?.trim() || "Zuhause" },
              },
            },
          },
        },
        select: publicUser,
      });
    });
  }
  app.post<{ Body: RegisterBody & { setupToken: string } }>(
    "/auth/setup",
    { schema: { tags: ["Auth"], body: setup }, config: authLimit },
    async (request, reply) => {
      if (!safeTokenEqual(request.body.setupToken, config.setupToken))
        return reply
          .code(403)
          .send({ message: "Ungültiger Einrichtungscode." });
      if (await db.bootstrapLock.findUnique({ where: { id: 1 } }))
        return reply
          .code(409)
          .send({ message: "Die Einrichtung ist bereits abgeschlossen." });
      try {
        const user = await createAccount(request.body, true);
        await auth.issueSession(user.id, reply);
        return reply.code(201).send({ user });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        )
          return reply
            .code(409)
            .send({ message: "Einrichtung oder Benutzer existiert bereits." });
        throw error;
      }
    },
  );
  app.post<{ Body: RegisterBody }>(
    "/auth/register",
    { schema: { tags: ["Auth"], body: registration }, config: authLimit },
    async (request, reply) => {
      if (
        !config.registrationEnabled ||
        !(await db.bootstrapLock.findUnique({ where: { id: 1 } }))
      )
        return reply
          .code(403)
          .send({ message: "Registrierung ist deaktiviert." });
      try {
        const user = await createAccount(request.body, false);
        await auth.issueSession(user.id, reply);
        return reply.code(201).send({ user });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        )
          return reply
            .code(409)
            .send({ message: "Dieses Konto kann nicht erstellt werden." });
        throw error;
      }
    },
  );
  app.post<{ Body: { email: string; password: string } }>(
    "/auth/login",
    { schema: { tags: ["Auth"], body: credentials }, config: authLimit },
    async (request, reply) => {
      const user = await db.user.findUnique({
        where: { email: request.body.email.toLowerCase().trim() },
      });
      const valid = await verifyPassword(
        request.body.password,
        user?.passwordHash ?? dummyHash,
      );
      if (
        !user ||
        !valid ||
        (await db.accountStatus.findUnique({ where: { userId: user.id } }))
          ?.disabled
      )
        return reply
          .code(401)
          .send({ message: "E-Mail oder Passwort ist falsch." });
      await auth.issueSession(user.id, reply);
      const {
        passwordHash: _passwordHash,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...safeUser
      } = user;
      return { user: safeUser };
    },
  );
  app.post(
    "/auth/logout",
    { schema: { tags: ["Auth"] } },
    async (request, reply) => {
      await auth.logout(request, reply);
      return { ok: true };
    },
  );
  app.get(
    "/auth/me",
    { schema: { tags: ["Auth"] } },
    async (request, reply) => {
      const user = await auth.currentUser(request);
      if (!user) return reply.code(401).send({ message: "Bitte anmelden." });
      return { user };
    },
  );
  app.patch<{ Body: { name: string; locale: string } }>(
    "/auth/profile",
    { schema: { tags: ["Auth"], body: profile } },
    async (request, reply) => {
      const user = await auth.currentUser(request);
      if (!user) return reply.code(401).send({ message: "Bitte anmelden." });
      return {
        user: await db.user.update({
          where: { id: user.id },
          data: { name: request.body.name.trim(), locale: request.body.locale },
          select: publicUser,
        }),
      };
    },
  );
  app.post<{ Body: { currentPassword: string; newPassword: string } }>(
    "/auth/password",
    { schema: { tags: ["Auth"], body: changePassword }, config: authLimit },
    async (request, reply) => {
      const user = await auth.currentUser(request);
      if (!user) return reply.code(401).send({ message: "Bitte anmelden." });
      const account = await db.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      if (
        !(await verifyPassword(
          request.body.currentPassword,
          account.passwordHash,
        ))
      )
        return reply
          .code(403)
          .send({ message: "Das aktuelle Passwort ist falsch." });
      const passwordHash = await hashPassword(request.body.newPassword);
      await db.$transaction([
        db.user.update({ where: { id: user.id }, data: { passwordHash } }),
        db.session.deleteMany({ where: { userId: user.id } }),
      ]);
      await auth.issueSession(user.id, reply);
      return { ok: true };
    },
  );
}
