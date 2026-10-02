import { Prisma, type PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { hashToken } from "../lib/password";
import { RecipeError } from "../lib/errors";
import { readRecipe, lockRecipe } from "./recipes";
import type { Config } from "../lib/config";
import type { PublicRecipeResponse } from "../../shared/public-recipes";
export async function shareLinks(db: PrismaClient, userId: string, id: string) {
  return db.$transaction(
    async (tx) => {
      const recipe = await readRecipe(tx, userId, id, true);
      const owner = await tx.recipe.findUnique({
        where: { id },
        select: { creatorId: true },
      });
      if (owner?.creatorId !== userId)
        throw new RecipeError(
          403,
          "Nur der Ersteller verwaltet öffentliche Links.",
        );
      return tx.shareLink.findMany({
        where: { recipeId: id, userId },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true, expiresAt: true, revokedAt: true },
        take: 100,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
export async function createShare(
  db: PrismaClient,
  userId: string,
  id: string,
  days: number,
  revision: number,
  config: Config,
) {
  return db.$transaction(
    async (tx) => {
      const { row } = await lockRecipe(tx, userId, id, false, true);
      if (row.creatorId !== userId)
        throw new RecipeError(403, "Nur der Ersteller darf öffentlich teilen.");
      if (row.revision !== revision)
        throw new RecipeError(
          409,
          "Rezept geändert. Vor der Freigabe neu laden.",
        );
      if (
        (await tx.shareLink.count({
          where: {
            recipeId: id,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
        })) >= 20
      )
        throw new RecipeError(400, "Höchstens 20 aktive Links pro Rezept.");
      const token = randomBytes(32).toString("hex");
      const link = await tx.shareLink.create({
        data: {
          recipeId: id,
          userId,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + days * 86400000),
        },
      });
      return {
        id: link.id,
        url: `${config.origin}/r/${token}`,
        qrUrl: `/api/v1/public-recipes/${token}/qr`,
        expiresAt: link.expiresAt,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}
export async function revokeShare(
  db: PrismaClient,
  userId: string,
  id: string,
  linkId: string,
) {
  return db.$transaction(
    async (tx) => {
      const { row } = await lockRecipe(tx, userId, id, true);
      if (row.creatorId !== userId)
        throw new RecipeError(
          403,
          "Nur der Ersteller darf öffentliche Links widerrufen.",
        );
      const link = await tx.shareLink.findFirst({
        where: { id: linkId, recipeId: id, userId },
      });
      if (!link) throw new RecipeError(404, "Link nicht gefunden.");
      await tx.shareLink.update({
        where: { id: link.id },
        data: { revokedAt: new Date() },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}
export async function publicRecipe(
  db: PrismaClient,
  token: string,
  config: Config,
): Promise<PublicRecipeResponse> {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new RecipeError(404, "Freigabe nicht gefunden.");
  return db.$transaction(
    async (tx) => {
      const link = await tx.shareLink.findFirst({
        where: {
          tokenHash: hashToken(token),
          revokedAt: null,
          expiresAt: { gt: new Date() },
          recipe: {
            deletedAt: null,
            household: { members: { some: { userId: { not: "" } } } },
          },
        },
      });
      if (!link)
        throw new RecipeError(404, "Freigabe nicht gefunden oder abgelaufen.");
      const member = await tx.householdMember.findFirst({
        where: {
          userId: link.userId,
          household: { recipes: { some: { id: link.recipeId } } },
        },
      });
      if (!member) throw new RecipeError(404, "Freigabe nicht mehr verfügbar.");
      const detail = await readRecipe(tx, link.userId, link.recipeId);
      return publicResponse(
        detail,
        config,
        `/r/${token}`,
        `/api/v1/public-recipes/${token}`,
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

function publicNutrition(
  n: NonNullable<import("../../shared/recipes").RecipeDetail["nutrition"]>,
) {
  return {
    calories: n.calories,
    carbohydrates: n.carbohydrates,
    fats: n.fats,
    proteins: n.proteins,
    basis: n.basis,
  };
}
export function publicResponse(
  detail: import("../../shared/recipes").RecipeDetail,
  config: Config,
  pagePath: string,
  imageBase: string,
): PublicRecipeResponse {
  const {
    id,
    title,
    description,
    servings,
    prepMinutes,
    cookMinutes,
    ingredients,
    steps,
    tags,
    categories,
    vegetarian,
    vegan,
    allergens,
    nutrition,
  } = detail;
  const images = detail.images.map((image) => ({
    id: image.id,
    url: `${imageBase}/images/${image.id}`,
  }));
  const recipe = {
    id,
    title,
    description,
    servings,
    prepMinutes,
    cookMinutes,
    ingredients,
    steps,
    tags,
    categories,
    vegetarian,
    vegan,
    allergens,
    nutrition: nutrition ? publicNutrition(nutrition) : null,
    images,
  };
  const schemaOrg: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: title,
    description,
    recipeYield: String(servings),
    prepTime: `PT${prepMinutes}M`,
    cookTime: `PT${cookMinutes}M`,
    totalTime: `PT${prepMinutes + cookMinutes}M`,
    recipeIngredient: ingredients.map((i) =>
      [i.amount, i.unit, i.name, i.note].filter(Boolean).join(" "),
    ),
    recipeInstructions: steps.map((s) => ({
      "@type": "HowToStep",
      text: s.instruction,
    })),
    image: images.map((image) => config.origin + image.url),
    keywords: tags.join(", "),
    recipeCategory: categories.join(", "),
    url: config.origin + pagePath,
  };
  if (vegan || vegetarian)
    schemaOrg.suitableForDiet = `https://schema.org/${vegan ? "VeganDiet" : "VegetarianDiet"}`;
  if (nutrition && nutrition.basis === "SERVING")
    schemaOrg.nutrition = {
      "@type": "NutritionInformation",
      ...(nutrition.calories ? { calories: nutrition.calories + " kcal" } : {}),
      ...(nutrition.carbohydrates
        ? { carbohydrateContent: nutrition.carbohydrates + " g" }
        : {}),
      ...(nutrition.fats ? { fatContent: nutrition.fats + " g" } : {}),
      ...(nutrition.proteins
        ? { proteinContent: nutrition.proteins + " g" }
        : {}),
    };
  return { recipe, schemaOrg };
}
