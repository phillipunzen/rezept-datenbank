import { randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import type { PrismaClient } from "@prisma/client";
import type { Config } from "../lib/config";
import { hashToken, hashPassword } from "../lib/password";
import { RecipeError } from "../lib/errors";
export function accountRecovery(db: PrismaClient, config: Config) {
  const mail = config.smtp
    ? nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        requireTLS: config.smtp.requireTLS,
        auth: config.smtp.user
          ? { user: config.smtp.user, pass: config.smtp.password }
          : undefined,
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
        disableFileAccess: true,
        disableUrlAccess: true,
      })
    : null;
  return {
    async request(email: string) {
      if (!mail)
        throw new RecipeError(
          503,
          "Passwortreset ist noch nicht konfiguriert.",
        );
      const user = await db.user.findUnique({
        where: { email: email.toLowerCase().trim() },
        include: { accountStatus: true },
      });
      if (!user || user.accountStatus?.disabled) return;
      const token = randomBytes(32).toString("hex"),
        tokenHash = hashToken(token);
      const created = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM User WHERE id=${user.id} FOR UPDATE`;
        const recent = await tx.passwordReset.count({
          where: {
            userId: user.id,
            createdAt: { gt: new Date(Date.now() - 60000) },
          },
        });
        if (recent) return false;
        await tx.passwordReset.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        await tx.passwordReset.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt: new Date(Date.now() + 20 * 60000),
          },
        });
        return true;
      });
      if (!created) return;
      try {
        await mail.sendMail({
          from: config.smtp!.from,
          to: user.email,
          subject: "Rezeptdatenbank – Passwort zurücksetzen / Reset password",
          text: `Passwort innerhalb von 20 Minuten zurücksetzen / Reset within 20 minutes:\n${config.origin}/#reset=${token}\n\nNicht angefordert? Diese Nachricht ignorieren. / Not requested? Ignore this message.`,
        });
      } catch {
        await db.passwordReset.updateMany({
          where: { tokenHash, usedAt: null },
          data: { usedAt: new Date() },
        });
        return false;
      }
    },
    async reset(token: string, password: string) {
      const passwordHash = await hashPassword(password);
      return db.$transaction(async (tx) => {
        const record = await tx.passwordReset.findUnique({
          where: { tokenHash: hashToken(token) },
        });
        if (!record)
          throw new RecipeError(400, "Link ungültig oder abgelaufen.");
        await tx.$queryRaw`SELECT id FROM User WHERE id=${record.userId} FOR UPDATE`;
        if (
          (
            await tx.accountStatus.findUnique({
              where: { userId: record.userId },
            })
          )?.disabled
        )
          throw new RecipeError(400, "Link ungültig oder abgelaufen.");
        const used = await tx.passwordReset.updateMany({
          where: {
            tokenHash: record.tokenHash,
            usedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { usedAt: new Date() },
        });
        if (!used.count)
          throw new RecipeError(400, "Link ungültig oder abgelaufen.");
        await tx.user.update({
          where: { id: record.userId },
          data: { passwordHash },
        });
        await tx.session.deleteMany({ where: { userId: record.userId } });
        await tx.passwordReset.updateMany({
          where: { userId: record.userId, usedAt: null },
          data: { usedAt: new Date() },
        });
      });
    },
    close() {
      mail?.close();
    },
  };
}
