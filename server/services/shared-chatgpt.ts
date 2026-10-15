import type { Prisma, PrismaClient } from "@prisma/client";
import { RecipeError } from "../lib/errors";

export const chatgptInstanceId = "instance";

// This predicate is also checked when acquiring the credential lease and immediately
// before inference, so a stale UI/selection cannot grant access to another account.
export function chatgptAccountAccess(userId: string, accountId: string, shared: boolean): Prisma.ChatgptAccountWhereInput {
  return {
    id: accountId, userId, provider: "device", encryptedTokens: { not: null }, blocked: false,
    ...(shared ? {
      sharedInstance: { is: { id: chatgptInstanceId, enabled: true } },
      user: { isAdmin: true, OR: [{ accountStatus: null }, { accountStatus: { disabled: false } }] },
    } : { active: true }),
  };
}

export async function sharedChatgptSetting(db: PrismaClient) {
  return db.chatgptInstance.findUnique({ where: { id: chatgptInstanceId }, include: { account: { include: { user: { select: { isAdmin: true, accountStatus: { select: { disabled: true } } } } } } } });
}

export function sharedChatgptConnected(setting: Awaited<ReturnType<typeof sharedChatgptSetting>>) {
  const a = setting?.account;
  return !!(a?.provider === "device" && a.encryptedTokens && a.user.isAdmin && !a.user.accountStatus?.disabled);
}

export async function setSharedChatgpt(db: PrismaClient, userId: string, accountId: string | null) {
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`;
    const admin = await tx.user.findUnique({ where: { id: userId }, include: { accountStatus: true } });
    if (!admin?.isAdmin || admin.accountStatus?.disabled) throw new RecipeError(403, "Administratorrechte erforderlich.");
    if (accountId) {
      const account = await tx.chatgptAccount.findFirst({ where: { id: accountId, userId, provider: "device", encryptedTokens: { not: null } } });
      if (!account) throw new RecipeError(404, "Bitte eine eigene, verbundene ChatGPT-Verbindung auswählen.");
    }
    const data = { enabled: accountId !== null, accountId };
    await tx.chatgptInstance.upsert({ where: { id: chatgptInstanceId }, create: { id: chatgptInstanceId, ...data }, update: data });
  });
}
