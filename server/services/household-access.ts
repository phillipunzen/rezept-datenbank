import type { Prisma, PrismaClient } from "@prisma/client";
import { RecipeError } from "../lib/errors";
export type Db = PrismaClient | Prisma.TransactionClient;
export async function lockHousehold(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM Household WHERE id = ${id} FOR UPDATE`;
}
export async function membership(
  db: Db,
  userId: string,
  householdId: string,
  write = false,
) {
  const member = await db.householdMember.findUnique({
    where: { householdId_userId: { householdId, userId } },
  });
  if (!member) throw new RecipeError(404, "Haushalt nicht gefunden.");
  if (write && member.role === "VIEWER")
    throw new RecipeError(403, "Du hast in diesem Haushalt nur Leserechte.");
  return member;
}
