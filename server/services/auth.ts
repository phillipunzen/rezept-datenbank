import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../lib/config";
import { hashToken } from "../lib/password";
import { publicUser } from "../lib/schemas";
export function authService(db: PrismaClient, config: Config) {
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    secure: config.secureCookie,
    sameSite: "lax" as const,
  };
  return {
    async currentUser(request: FastifyRequest) {
      const token = request.cookies.session;
      if (!token) return null;
      const session = await db.session.findUnique({
        where: { tokenHash: hashToken(token) },
        include: {
          user: {
            select: {
              ...publicUser,
              accountStatus: { select: { disabled: true } },
            },
          },
        },
      });
      if (
        !session ||
        session.expiresAt <= new Date() ||
        session.user.accountStatus?.disabled
      )
        return null;
      const { accountStatus: _status, ...user } = session.user;
      return user;
    },
    async issueSession(userId: string, reply: FastifyReply) {
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + config.sessionHours * 3600000);
      await db.session.create({
        data: { tokenHash: hashToken(token), userId, expiresAt },
      });
      reply.setCookie("session", token, {
        ...cookieOptions,
        expires: expiresAt,
      });
    },
    async logout(request: FastifyRequest, reply: FastifyReply) {
      if (request.cookies.session)
        await db.session.deleteMany({
          where: { tokenHash: hashToken(request.cookies.session) },
        });
      reply.clearCookie("session", cookieOptions);
    },
  };
}
