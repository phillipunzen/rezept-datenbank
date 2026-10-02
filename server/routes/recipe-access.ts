import type { FastifyInstance, FastifyRequest } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  RecipeError,
  recipeRow,
  lockRecipe,
  readRecipe,
  detailDto,
} from "../services/recipes";
import { detailResponse, idParams } from "../lib/recipe-schemas";
export async function recipeAccessRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  userId: (request: FastifyRequest) => Promise<string>,
) {
  const secure = { tags: ["Recipe access"], security: [{ cookieAuth: [] }] };
  app.get<{ Params: { id: string } }>(
    "/recipes/:id/access",
    { schema: { ...secure, params: idParams } },
    async (request) => {
      const actor = await userId(request);
      return db.$transaction(
        async (tx) => {
          const { row, canEdit } = await recipeRow(
            tx,
            actor,
            request.params.id,
          );
          if (!canEdit || row.creatorId !== actor)
            throw new RecipeError(
              403,
              "Nur der Ersteller darf Freigaben verwalten.",
            );
          const [members, grants] = await Promise.all([
            tx.householdMember.findMany({
              where: { householdId: row.householdId, userId: { not: actor } },
              select: {
                userId: true,
                role: true,
                user: { select: { name: true } },
              },
              orderBy: { createdAt: "asc" },
            }),
            tx.recipeGrant.findMany({
              where: { recipeId: row.id },
              select: { userId: true, permission: true },
            }),
          ]);
          return {
            members: members.map((member) => ({
              userId: member.userId,
              name: member.user.name,
              role: member.role,
            })),
            grants,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    },
  );
  app.put<{
    Params: { id: string };
    Body: {
      revision: number;
      grants: { userId: string; permission: "VIEW" | "EDIT" }[];
    };
  }>(
    "/recipes/:id/access",
    {
      schema: {
        ...secure,
        params: idParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["revision", "grants"],
          properties: {
            revision: { type: "integer", minimum: 1 },
            grants: {
              type: "array",
              maxItems: 100,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["userId", "permission"],
                properties: {
                  userId: { type: "string", minLength: 1, maxLength: 30 },
                  permission: { type: "string", enum: ["VIEW", "EDIT"] },
                },
              },
            },
          },
        },
        response: { 200: detailResponse },
      },
    },
    async (request) => {
      const actor = await userId(request);
      const recipe = await db.$transaction(
        async (tx) => {
          const { row, canEdit } = await lockRecipe(
            tx,
            actor,
            request.params.id,
            false,
            true,
          );
          if (row.creatorId !== actor)
            throw new RecipeError(
              403,
              "Nur der Ersteller darf Freigaben verwalten.",
            );
          if (row.visibility !== "PRIVATE")
            throw new RecipeError(
              400,
              "Haushaltsrezepte sind bereits für alle Mitglieder sichtbar. Freigaben gelten für private Rezepte.",
            );
          const grants = request.body.grants;
          if (
            new Set(grants.map((grant) => grant.userId)).size !== grants.length
          )
            throw new RecipeError(
              400,
              "Ein Mitglied darf nur einmal freigegeben werden.",
            );
          const members = await tx.householdMember.findMany({
            where: {
              householdId: row.householdId,
              userId: { in: grants.map((g) => g.userId) },
            },
          });
          if (
            members.length !== grants.length ||
            grants.some((grant) => grant.userId === actor)
          )
            throw new RecipeError(
              400,
              "Freigaben sind nur für andere Mitglieder desselben Haushalts möglich.",
            );
          if (
            grants.some(
              (grant) =>
                grant.permission === "EDIT" &&
                members.find((m) => m.userId === grant.userId)?.role ===
                  "VIEWER",
            )
          )
            throw new RecipeError(
              400,
              "Mitglieder mit Leserechten können keine Bearbeitungsfreigabe erhalten.",
            );
          const changed = await tx.recipe.updateMany({
            where: { id: row.id, revision: request.body.revision },
            data: { revision: { increment: 1 } },
          });
          if (!changed.count)
            throw new RecipeError(
              409,
              "Das Rezept wurde inzwischen geändert. Bitte neu laden.",
            );
          await tx.recipeVersion.create({
            data: {
              recipeId: row.id,
              authorId: actor,
              revision: row.revision,
              snapshot: JSON.parse(
                JSON.stringify(detailDto(row, actor, canEdit)),
              ) as Prisma.InputJsonValue,
            },
          });
          await tx.recipeGrant.deleteMany({ where: { recipeId: row.id } });
          if (grants.length)
            await tx.recipeGrant.createMany({
              data: grants.map((grant) => ({ recipeId: row.id, ...grant })),
            });
          return readRecipe(tx, actor, row.id);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );
      return { recipe };
    },
  );
}
