import { Prisma, type PrismaClient } from "@prisma/client";
import type { Config } from "../lib/config";
import { RecipeError } from "../lib/errors";
import { lockRecipe, readRecipe } from "./recipes";
import { publicResponse } from "./public-recipes";
import type {
  PublicCatalogResponse,
  RecipePublicationStatus,
} from "../../shared/public-recipes";

const available = Prisma.sql`FROM RecipePublication p
  JOIN Recipe r ON r.id=p.recipeId
  JOIN HouseholdMember m ON m.userId=p.publisherId AND m.householdId=r.householdId
  LEFT JOIN AccountStatus a ON a.userId=p.publisherId
  WHERE p.publishedAt IS NOT NULL AND p.publisherId=r.creatorId AND r.deletedAt IS NULL
  AND (a.disabled IS NULL OR a.disabled=false)`;
function enabled(config: Config) {
  if (!config.publicCatalogEnabled)
    throw new RecipeError(404, "Öffentlicher Katalog nicht verfügbar.");
}
function status(
  config: Config,
  id: string,
  row: { publishedAt: Date | null; revision: number } | null,
): RecipePublicationStatus {
  const published = Boolean(row?.publishedAt);
  return {
    enabled: config.publicCatalogEnabled,
    published,
    revision: row?.revision ?? 0,
    url:
      published && config.publicCatalogEnabled
        ? `${config.origin}/entdecken/${id}`
        : null,
  };
}
export async function publication(
  db: PrismaClient,
  userId: string,
  id: string,
  config: Config,
) {
  return db.$transaction(
    async (tx) => {
      await readRecipe(tx, userId, id, true);
      const owner = await tx.recipe.findUnique({
        where: { id },
        select: { creatorId: true },
      });
      if (owner?.creatorId !== userId)
        throw new RecipeError(
          403,
          "Nur der Ersteller verwaltet Veröffentlichungen.",
        );
      return status(
        config,
        id,
        await tx.recipePublication.findUnique({ where: { recipeId: id } }),
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function changePublication(
  db: PrismaClient,
  userId: string,
  id: string,
  input: {
    published: boolean;
    revision: number;
    recipeRevision: number;
    confirmedPublic?: boolean;
  },
  config: Config,
) {
  return db.$transaction(
    async (tx) => {
      const { row } = await lockRecipe(
        tx,
        userId,
        id,
        !input.published,
        input.published,
      );
      if (row.creatorId !== userId)
        throw new RecipeError(403, "Nur der Ersteller darf veröffentlichen.");
      if (input.published) {
        enabled(config);
        if (input.confirmedPublic !== true)
          throw new RecipeError(
            400,
            "Öffentliche Sichtbarkeit bitte ausdrücklich bestätigen.",
          );
      }
      const current = await tx.recipePublication.findUnique({
        where: { recipeId: id },
      });
      if (
        row.revision !== input.recipeRevision ||
        (current?.revision ?? 0) !== input.revision
      )
        throw new RecipeError(
          409,
          "Rezept oder Veröffentlichung geändert. Bitte neu laden.",
        );
      const data = {
        publisherId: userId,
        publishedAt: input.published ? new Date() : null,
      };
      const updated = await tx.recipePublication.upsert({
        where: { recipeId: id },
        create: { recipeId: id, ...data },
        update: { ...data, revision: { increment: 1 } },
      });
      return status(config, id, updated);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}
export async function catalogRecipe(
  db: PrismaClient,
  id: string,
  config: Config,
) {
  enabled(config);
  return db.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ publisherId: string }[]>(
        Prisma.sql`SELECT p.publisherId ${available} AND r.id=${id}`,
      );
      if (!rows.length)
        throw new RecipeError(404, "Rezept nicht öffentlich verfügbar.");
      return publicResponse(
        await readRecipe(tx, rows[0].publisherId, id),
        config,
        `/entdecken/${id}`,
        `/api/v1/catalog/recipes/${id}`,
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function catalog(
  db: PrismaClient,
  query: { q?: string; page?: number; pageSize?: number; diet?: string },
  config: Config,
): Promise<PublicCatalogResponse> {
  enabled(config);
  const q = (query.q ?? "").trim().toLowerCase(),
    page = query.page ?? 1,
    pageSize = query.pageSize ?? 24;
  const search = q
    ? Prisma.sql`AND (LOCATE(${q},LOWER(r.title))>0 OR LOCATE(${q},LOWER(r.description))>0
    OR EXISTS(SELECT 1 FROM RecipeTag rt JOIN Tag t ON t.id=rt.tagId WHERE rt.recipeId=r.id AND LOCATE(${q},LOWER(t.name))>0)
    OR EXISTS(SELECT 1 FROM RecipeCategory rc JOIN Category c ON c.id=rc.categoryId WHERE rc.recipeId=r.id AND LOCATE(${q},LOWER(c.name))>0))`
    : Prisma.empty;
  const diet =
    query.diet === "vegan"
      ? Prisma.sql`AND r.vegan=true`
      : query.diet === "vegetarian"
        ? Prisma.sql`AND (r.vegetarian=true OR r.vegan=true)`
        : Prisma.empty;
  return db.$transaction(
    async (tx) => {
      const count = await tx.$queryRaw<{ total: bigint }[]>(
        Prisma.sql`SELECT COUNT(*) total ${available} ${search} ${diet}`,
      );
      const ids = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT r.id ${available} ${search} ${diet} ORDER BY p.publishedAt DESC,r.id ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      );
      const rows = await tx.recipe.findMany({
        where: { id: { in: ids.map((r) => r.id) } },
        select: {
          id: true,
          title: true,
          description: true,
          servings: true,
          prepMinutes: true,
          cookMinutes: true,
          vegetarian: true,
          vegan: true,
          tags: { select: { tag: { select: { name: true } } } },
          categories: { select: { category: { select: { name: true } } } },
          images: {
            select: { id: true },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 1,
          },
        },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      return {
        total: Number(count[0].total),
        page,
        pageSize,
        recipes: ids.map(({ id }) => {
          const r = byId.get(id)!;
          return {
            ...r,
            tags: r.tags.map((t) => t.tag.name),
            categories: r.categories.map((c) => c.category.name),
            images: r.images.map((i) => ({
              id: i.id,
              url: `/api/v1/catalog/recipes/${id}/images/${i.id}`,
            })),
          };
        }),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
