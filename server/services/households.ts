import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient, type HouseholdRole } from "@prisma/client";
import { RecipeError } from "../lib/errors";
import { hashToken, hashPassword } from "../lib/password";
import { publicUser } from "../lib/schemas";
import { lockHousehold, membership, type Db } from "./household-access";
import {
  isManager,
  type HouseholdDetail,
  type InvitationPreview,
} from "../../shared/households";

const transactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
};
export async function householdDetail(
  db: Db,
  userId: string,
  id: string,
): Promise<HouseholdDetail> {
  const member = await membership(db, userId, id);
  const manager = isManager(member.role);
  const household = await db.household.findUniqueOrThrow({ where: { id } });
  const members = await db.householdMember.findMany({
    where: { householdId: id },
    orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
    include: { user: { select: { name: true, email: true } } },
  });
  const invitations = manager
    ? await db.householdInvitation.findMany({
        where: { householdId: id, acceptedAt: null, revokedAt: null },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    : [];
  return {
    id,
    name: household.name,
    revision: household.revision,
    role: member.role,
    canManage: manager,
    members: members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      ...(manager ? { email: m.user.email } : {}),
      role: m.role,
      createdAt: m.createdAt.toISOString(),
    })),
    invitations: invitations.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    })),
  };
}
async function management(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
  revision: number,
  requireManager = true,
) {
  await lockHousehold(tx, id);
  const actor = await membership(tx, userId, id);
  if (requireManager && !isManager(actor.role))
    throw new RecipeError(
      403,
      "Nur Eigentümer und Administratoren dürfen den Haushalt verwalten.",
    );
  const household = await tx.household.findUniqueOrThrow({ where: { id } });
  if (household.revision !== revision)
    throw new RecipeError(
      409,
      "Der Haushalt wurde inzwischen geändert. Bitte neu laden.",
    );
  return actor;
}
const bump = (tx: Prisma.TransactionClient, id: string) =>
  tx.household.update({ where: { id }, data: { revision: { increment: 1 } } });
export async function createHousehold(
  db: PrismaClient,
  userId: string,
  name: string,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`;
    if ((await tx.householdMember.count({ where: { userId } })) >= 20)
      throw new RecipeError(
        400,
        "Du kannst höchstens 20 Haushalten angehören.",
      );
    const household = await tx.household.create({
      data: {
        name: name.trim(),
        members: { create: { userId, role: "OWNER" } },
      },
    });
    return householdDetail(tx, userId, household.id);
  }, transactionOptions);
}
export async function renameHousehold(
  db: PrismaClient,
  userId: string,
  id: string,
  name: string,
  revision: number,
) {
  return db.$transaction(async (tx) => {
    await management(tx, userId, id, revision);
    await tx.household.update({
      where: { id },
      data: { name: name.trim(), revision: { increment: 1 } },
    });
    return householdDetail(tx, userId, id);
  }, transactionOptions);
}
async function protectOwner(
  tx: Prisma.TransactionClient,
  householdId: string,
  targetRole: HouseholdRole,
) {
  if (
    targetRole === "OWNER" &&
    (await tx.householdMember.count({
      where: { householdId, role: "OWNER" },
    })) <= 1
  )
    throw new RecipeError(
      409,
      "Mindestens ein Eigentümer muss bleiben. Ernenne zuerst ein anderes Mitglied zum Eigentümer.",
    );
}
export async function changeMember(
  db: PrismaClient,
  userId: string,
  id: string,
  targetId: string,
  role: HouseholdRole | null,
  revision: number,
  leave = false,
) {
  return db.$transaction(async (tx) => {
    const actor = await management(tx, userId, id, revision, !leave);
    const target = await tx.householdMember.findUnique({
      where: { householdId_userId: { householdId: id, userId: targetId } },
    });
    if (!target) throw new RecipeError(404, "Mitglied nicht gefunden.");
    if (leave && targetId !== userId)
      throw new RecipeError(
        403,
        "Du kannst nur selbst aus dem Haushalt austreten.",
      );
    if (
      !leave &&
      actor.role === "ADMIN" &&
      (isManager(target.role) || (role !== null && isManager(role)))
    )
      throw new RecipeError(
        403,
        "Administratoren dürfen nur Bearbeiter und Leser verwalten.",
      );
    if (target.role !== role) await protectOwner(tx, id, target.role);
    const affected = await tx.recipeGrant.findMany({
      where: {
        userId: targetId,
        recipe: { householdId: id },
        ...(role === "VIEWER" ? { permission: "EDIT" } : {}),
      },
      select: { recipeId: true },
    });
    if (role) {
      await tx.householdMember.update({
        where: { householdId_userId: { householdId: id, userId: targetId } },
        data: { role },
      });
      if (role === "VIEWER")
        await tx.recipeGrant.updateMany({
          where: {
            userId: targetId,
            permission: "EDIT",
            recipe: { householdId: id },
          },
          data: { permission: "VIEW" },
        });
    } else {
      await tx.householdMember.delete({
        where: { householdId_userId: { householdId: id, userId: targetId } },
      });
      await tx.recipePublication.updateMany({
        where: {
          publisherId: targetId,
          publishedAt: { not: null },
          recipe: { householdId: id },
        },
        data: { publishedAt: null, revision: { increment: 1 } },
      });
      // Rejoining does not silently resurrect an old private-recipe grant.
      await tx.recipeGrant.deleteMany({
        where: { userId: targetId, recipe: { householdId: id } },
      });
    }
    if ((!role || role === "VIEWER") && affected.length)
      await tx.recipe.updateMany({
        where: { id: { in: affected.map((grant) => grant.recipeId) } },
        data: { revision: { increment: 1 } },
      });
    if (target.role !== role)
      await tx.householdInvitation.updateMany({
        where: {
          householdId: id,
          inviterId: targetId,
          acceptedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    await bump(tx, id);
    return { ok: true };
  }, transactionOptions);
}
export async function createInvitation(
  db: PrismaClient,
  userId: string,
  id: string,
  email: string,
  role: HouseholdRole,
  revision: number,
  origin: string,
) {
  const token = randomBytes(32).toString("hex");
  return db.$transaction(async (tx) => {
    const actor = await management(tx, userId, id, revision);
    if (role === "OWNER" || (actor.role === "ADMIN" && role === "ADMIN"))
      throw new RecipeError(403, "Diese Rolle darfst du nicht einladen.");
    const normalized = email.trim().toLowerCase();
    if (
      await tx.householdMember.findFirst({
        where: { householdId: id, user: { email: normalized } },
      })
    )
      throw new RecipeError(409, "Dieses Konto ist bereits Mitglied.");
    const now = new Date();
    if (
      await tx.householdInvitation.findFirst({
        where: {
          householdId: id,
          email: normalized,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
      })
    )
      throw new RecipeError(
        409,
        "Für diese Adresse gibt es bereits eine aktive Einladung.",
      );
    if (
      (await tx.householdInvitation.count({
        where: {
          householdId: id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
      })) >= 50
    )
      throw new RecipeError(400, "Es sind bereits 50 Einladungen offen.");
    const invitation = await tx.householdInvitation.create({
      data: {
        householdId: id,
        inviterId: userId,
        email: normalized,
        role,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    await bump(tx, id);
    return {
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role,
        expiresAt: invitation.expiresAt.toISOString(),
        link: `${origin}/#invite=${token}`,
      },
    };
  }, transactionOptions);
}
export async function revokeInvitation(
  db: PrismaClient,
  userId: string,
  id: string,
  invitationId: string,
  revision: number,
) {
  return db.$transaction(async (tx) => {
    const actor = await management(tx, userId, id, revision);
    const invite = await tx.householdInvitation.findFirst({
      where: {
        id: invitationId,
        householdId: id,
        acceptedAt: null,
        revokedAt: null,
      },
    });
    if (!invite) throw new RecipeError(404, "Einladung nicht gefunden.");
    if (actor.role === "ADMIN" && invite.role === "ADMIN")
      throw new RecipeError(
        403,
        "Diese Einladung darf nur ein Eigentümer widerrufen.",
      );
    await tx.householdInvitation.update({
      where: { id: invitationId },
      data: { revokedAt: new Date() },
    });
    await bump(tx, id);
    return { ok: true };
  }, transactionOptions);
}
async function validInvitation(db: Db, token: string) {
  const invite = await db.householdInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { household: { select: { name: true } } },
  });
  if (
    !invite ||
    invite.acceptedAt ||
    invite.revokedAt ||
    invite.expiresAt <= new Date()
  )
    throw new RecipeError(
      410,
      "Diese Einladung ist ungültig, abgelaufen oder bereits verwendet.",
    );
  return invite;
}
export async function previewInvitation(
  db: PrismaClient,
  token: string,
): Promise<InvitationPreview> {
  const invite = await validInvitation(db, token);
  return {
    householdName: invite.household.name,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt.toISOString(),
  };
}
async function consumeInvitation(
  tx: Prisma.TransactionClient,
  token: string,
  userId: string,
  email: string,
) {
  const before = await validInvitation(tx, token);
  await lockHousehold(tx, before.householdId);
  const invite = await validInvitation(tx, token);
  if (invite.email !== email.trim().toLowerCase())
    throw new RecipeError(
      403,
      "Die Einladung gehört zu einer anderen E-Mail-Adresse. Bitte mit dem eingeladenen Konto anmelden.",
    );
  await tx.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`;
  if (
    await tx.householdMember.findUnique({
      where: {
        householdId_userId: { householdId: invite.householdId, userId },
      },
    })
  )
    throw new RecipeError(409, "Du bist bereits Mitglied dieses Haushalts.");
  if (
    (await tx.householdMember.count({
      where: { householdId: invite.householdId },
    })) >= 100
  )
    throw new RecipeError(400, "Der Haushalt hat bereits 100 Mitglieder.");
  if ((await tx.householdMember.count({ where: { userId } })) >= 20)
    throw new RecipeError(400, "Du kannst höchstens 20 Haushalten angehören.");
  await tx.householdMember.create({
    data: { householdId: invite.householdId, userId, role: invite.role },
  });
  await tx.householdInvitation.update({
    where: { id: invite.id },
    data: { acceptedAt: new Date(), acceptedById: userId },
  });
  await bump(tx, invite.householdId);
  return { id: invite.householdId, name: invite.household.name };
}
export async function acceptInvitation(
  db: PrismaClient,
  token: string,
  userId: string,
) {
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: publicUser,
    });
    return {
      household: await consumeInvitation(tx, token, userId, user.email),
    };
  }, transactionOptions);
}
export async function registerInvitation(
  db: PrismaClient,
  body: { token: string; email: string; name: string; password: string },
) {
  const invite = await validInvitation(db, body.token);
  const email = body.email.trim().toLowerCase();
  if (invite.email !== email)
    throw new RecipeError(
      403,
      "Bitte die eingeladene E-Mail-Adresse verwenden.",
    );
  const passwordHash = await hashPassword(body.password);
  try {
    return await db.$transaction(async (tx) => {
      // Same order as accept/revoke: household first, then invitation/account data.
      await lockHousehold(tx, invite.householdId);
      await validInvitation(tx, body.token);
      const user = await tx.user.create({
        data: { email, name: body.name.trim(), passwordHash },
        select: publicUser,
      });
      return {
        user,
        household: await consumeInvitation(tx, body.token, user.id, email),
      };
    }, transactionOptions);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new RecipeError(
        409,
        "Für diese E-Mail-Adresse gibt es bereits ein Konto. Bitte anmelden.",
      );
    throw error;
  }
}
