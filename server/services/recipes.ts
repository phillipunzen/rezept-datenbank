import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  RecipeDetail,
  RecipeInput,
  RecipeSummary,
} from "../../shared/recipes";
import { normalizedName, unitDefinition } from "../../shared/recipes";
import { createHash } from "node:crypto";
import { deviceSignature, type DeviceStep } from "../../shared/devices";
import { RecipeError } from "../lib/errors";
export { RecipeError } from "../lib/errors";
import { membership, lockHousehold, type Db } from "./household-access";
export { membership } from "./household-access";
export function visibleRecipeWhere(userId: string): Prisma.RecipeWhereInput {
  return {
    household: { members: { some: { userId } } },
    OR: [
      { visibility: "HOUSEHOLD" },
      { creatorId: userId },
      { grants: { some: { userId } } },
    ],
  };
}
const canEditRow = (
  row: {
    visibility: string;
    creatorId: string;
    grants: { permission: string }[];
  },
  userId: string,
  role: string,
) =>
  role !== "VIEWER" &&
  (row.visibility === "HOUSEHOLD" ||
    row.creatorId === userId ||
    row.grants.some((grant) => grant.permission === "EDIT"));
const overviewInclude = (userId: string) => ({
  grants: { where: { userId }, select: { permission: true } },
  images: { orderBy: { createdAt: "asc" as const } },
  tags: { include: { tag: true } },
  categories: { include: { category: true } },
  creator: { select: { name: true } },
  favorites: { where: { userId }, select: { userId: true } },
  ratings: { select: { userId: true, value: true } },
});
export const fullInclude = (userId: string) => ({
  ...overviewInclude(userId),
  ingredients: {
    orderBy: { position: "asc" as const },
    include: { ingredient: true, unit: true, group: true },
  },
  steps: {
    orderBy: { position: "asc" as const },
    include: { ingredients: { include: { ingredient: true } } },
  },
  nutrition: true,
  allergens: true,
  deviceData: true,
});
type Overview = Prisma.RecipeGetPayload<{
  include: ReturnType<typeof overviewInclude>;
}>;
type Full = Prisma.RecipeGetPayload<{
  include: ReturnType<typeof fullInclude>;
}>;
export function summaryDto(
  row: Overview,
  userId: string,
  canEdit: boolean,
): RecipeSummary {
  return {
    id: row.id,
    householdId: row.householdId,
    visibility: row.visibility,
    title: row.title,
    description: row.description,
    servings: row.servings,
    prepMinutes: row.prepMinutes,
    cookMinutes: row.cookMinutes,
    difficulty: row.difficulty as RecipeInput["difficulty"],
    vegetarian: row.vegetarian,
    vegan: row.vegan,
    source: row.source,
    sourceUrl: row.sourceUrl,
    notes: row.notes,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    creatorName: row.creator.name,
    images: row.images.map((image) => ({
      id: image.id,
      url: `/api/v1/recipes/${row.id}/images/${image.id}`,
    })),
    tags: row.tags.map((link) => link.tag.name),
    categories: row.categories.map((link) => link.category.name),
    favorite: row.favorites.length > 0,
    rating: row.ratings.find((r) => r.userId === userId)?.value ?? null,
    averageRating: row.ratings.length
      ? row.ratings.reduce((sum, r) => sum + r.value, 0) / row.ratings.length
      : null,
    ratingCount: row.ratings.length,
    canEdit,
    canManageAccess: canEdit && row.creatorId === userId,
    canManagePublicLinks: row.creatorId === userId,
  };
}
export function detailDto(
  row: Full,
  userId: string,
  canEdit: boolean,
): RecipeDetail {
  return {
    ...summaryDto(row, userId, canEdit),
    ingredients: row.ingredients.map((i) => ({
      name: i.ingredient.name,
      amount: i.amount?.toString() ?? null,
      unit: i.unit?.name ?? "",
      group: i.group?.name ?? "",
      note: i.note,
    })),
    steps: row.steps.map((step) => ({
      instruction: step.instruction,
      durationSeconds: step.durationSeconds,
      ingredientIndexes: step.ingredients
        .map((link) => link.ingredient.position)
        .sort((a, b) => a - b),
    })),
    allergens: row.allergens.map((item) => item.name).sort(),
    nutrition: row.nutrition
      ? {
          calories: row.nutrition.calories?.toString() ?? null,
          carbohydrates: row.nutrition.carbohydrates?.toString() ?? null,
          fats: row.nutrition.fats?.toString() ?? null,
          proteins: row.nutrition.proteins?.toString() ?? null,
          basis: row.nutrition.basis as "SERVING" | "RECIPE" | "UNKNOWN",
          source: row.nutrition.source,
        }
      : null,
    deviceData: row.deviceData
      .filter((item) => item.deviceKey === "thermomix-tm6")
      .map((item) => ({
        deviceKey: "thermomix-tm6",
        contentHash: item.contentHash,
        current:
          item.contentHash ===
          createHash("sha256")
            .update(
              deviceSignature({
                servings: row.servings,
                ingredients: row.ingredients.map((i) => ({
                  name: i.ingredient.name,
                  amount: i.amount?.toString() ?? null,
                  unit: i.unit?.name ?? "",
                  group: i.group?.name ?? "",
                  note: i.note,
                })),
                steps: row.steps.map((step) => ({
                  instruction: step.instruction,
                  durationSeconds: step.durationSeconds,
                  ingredientIndexes: step.ingredients
                    .map((link) => link.ingredient.position)
                    .sort((a, b) => a - b),
                })),
              }),
            )
            .digest("hex"),
        steps: item.data as unknown as DeviceStep[],
        confirmedAt: item.confirmedAt.toISOString(),
      })),
  };
}
export async function recipeRow(
  db: Db,
  userId: string,
  id: string,
  includeDeleted = false,
  write = false,
) {
  const row = await db.recipe.findFirst({
    where: {
      id,
      ...(!includeDeleted ? { deletedAt: null } : {}),
      household: { members: { some: { userId } } },
      ...visibleRecipeWhere(userId),
    },
    include: fullInclude(userId),
  });
  if (!row) throw new RecipeError(404, "Rezept nicht gefunden.");
  const member = await membership(db, userId, row.householdId, write);
  const canEdit = canEditRow(row, userId, member.role);
  if (write && !canEdit)
    throw new RecipeError(403, "Du darfst dieses Rezept nur lesen.");
  return { row, canEdit };
}
export async function lockRecipe(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
  includeDeleted = false,
  write = false,
) {
  const existing = await tx.recipe.findUnique({
    where: { id },
    select: { householdId: true },
  });
  if (!existing) throw new RecipeError(404, "Rezept nicht gefunden.");
  await lockHousehold(tx, existing.householdId);
  await tx.$queryRaw`SELECT id FROM Recipe WHERE id = ${id} FOR UPDATE`;
  return recipeRow(tx, userId, id, includeDeleted, write);
}
export async function readRecipe(
  db: Db,
  userId: string,
  id: string,
  includeDeleted = false,
) {
  const { row, canEdit } = await recipeRow(db, userId, id, includeDeleted);
  return detailDto(row, userId, canEdit);
}
export interface ListOptions {
  householdId: string;
  q?: string;
  tag?: string;
  category?: string;
  favorites?: boolean;
  vegetarian?: boolean;
  vegan?: boolean;
  trash?: boolean;
  maxMinutes?: number;
  minRating?: number;
  availableIngredients?: string;
  maxMissing?: number;
  thermomix?: boolean;
  page?: number;
  pageSize?: number;
}
export async function listRecipes(
  db: PrismaClient,
  userId: string,
  query: ListOptions,
) {
  const member = await membership(db, userId, query.householdId);
  const page = query.page ?? 1,
    pageSize = query.pageSize ?? 24;
  const where: Prisma.RecipeWhereInput = {
    householdId: query.householdId,
    AND: [visibleRecipeWhere(userId)],
    deletedAt: query.trash ? { not: null } : null,
    ...(query.favorites ? { favorites: { some: { userId } } } : {}),
    ...(query.vegetarian ? { vegetarian: true } : {}),
    ...(query.vegan ? { vegan: true } : {}),
    ...(query.category
      ? { categories: { some: { category: { name: query.category } } } }
      : {}),
    ...(query.tag ? { tags: { some: { tag: { name: query.tag } } } } : {}),
  };
  if (query.q?.trim()) {
    const contains = query.q.trim();
    where.OR = [
      { title: { contains } },
      { description: { contains } },
      { ingredients: { some: { ingredient: { name: { contains } } } } },
      { tags: { some: { tag: { name: { contains } } } } },
      { categories: { some: { category: { name: { contains } } } } },
    ];
  }
  // Total time is derived from normalized prep/cook values, avoiding a denormalized column.
  if (query.maxMinutes !== undefined) {
    const candidates = await db.recipe.findMany({
      where,
      select: { id: true, prepMinutes: true, cookMinutes: true },
    });
    where.id = {
      in: candidates
        .filter((r) => r.prepMinutes + r.cookMinutes <= query.maxMinutes!)
        .map((r) => r.id),
    };
  }
  if (query.minRating !== undefined) {
    const rated = await db.rating.groupBy({
      by: ["recipeId"],
      where: { recipe: where },
      having: { value: { _avg: { gte: query.minRating } } },
    });
    where.AND = [
      visibleRecipeWhere(userId),
      { id: { in: rated.map((row) => row.recipeId) } },
    ];
  }
  if (query.thermomix) {
    const candidates = await db.recipe.findMany({
      where: { ...where, deviceData: { some: { deviceKey: "thermomix-tm6" } } },
      include: fullInclude(userId),
      take: 5001,
    });
    if (candidates.length > 5000)
      throw new RecipeError(
        400,
        "Suche für den Gerätefilter weiter eingrenzen.",
      );
    where.id = {
      in: candidates
        .filter((row) =>
          detailDto(row, userId, false).deviceData.some(
            (data) => data.current && data.steps.some((step) => step.enabled),
          ),
        )
        .map((row) => row.id),
    };
  }
  const available = new Set(
    (query.availableIngredients ?? "")
      .split(",")
      .map(normalizedName)
      .filter(Boolean),
  );
  let missing: Map<string, string[]> | null = null;
  let matchingIds: string[] | null = null;
  if (available.size) {
    if (available.size > 50)
      throw new RecipeError(400, "Höchstens 50 vorhandene Zutaten.");
    const candidates = await db.recipe.findMany({
      where,
      select: {
        id: true,
        ingredients: {
          select: {
            ingredient: { select: { name: true, normalizedName: true } },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 5001,
    });
    if (candidates.length > 5000)
      throw new RecipeError(
        400,
        "Suche für den Zutatenvergleich weiter eingrenzen.",
      );
    missing = new Map(
      candidates.map((row) => [
        row.id,
        [
          ...new Set(
            row.ingredients
              .filter((i) => !available.has(i.ingredient.normalizedName))
              .map((i) => i.ingredient.name),
          ),
        ],
      ]),
    );
    matchingIds = candidates
      .filter((row) => missing!.get(row.id)!.length <= (query.maxMissing ?? 3))
      .sort((a, b) => missing!.get(a.id)!.length - missing!.get(b.id)!.length)
      .map((row) => row.id);
    where.id = { in: matchingIds };
  }
  const pageIds = matchingIds?.slice((page - 1) * pageSize, page * pageSize);
  const [total, rows] = await db.$transaction([
    db.recipe.count({ where }),
    db.recipe.findMany({
      where: pageIds ? { ...where, id: { in: pageIds } } : where,
      include: overviewInclude(userId),
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: pageIds ? 0 : (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    recipes: (pageIds
      ? rows.sort((a, b) => pageIds.indexOf(a.id) - pageIds.indexOf(b.id))
      : rows
    ).map((row) => ({
      ...summaryDto(row, userId, canEditRow(row, userId, member.role)),
      ...(missing ? { missingIngredients: missing.get(row.id) ?? [] } : {}),
    })),
    total,
    page,
    pageSize,
  };
}
const uniqueLabels = (values: string[]) => [
  ...new Map(
    values.map((value) => [normalizedName(value), value.trim()]),
  ).values(),
];
async function writeRelations(
  tx: Prisma.TransactionClient,
  recipeId: string,
  data: RecipeInput,
) {
  const groupIds = new Map<string, string>();
  for (const input of data.ingredients) {
    const name = input.group.trim();
    if (name && !groupIds.has(normalizedName(name))) {
      const group = await tx.recipeIngredientGroup.create({
        data: { recipeId, name, position: groupIds.size },
      });
      groupIds.set(normalizedName(name), group.id);
    }
  }
  const ingredientRows: string[] = [];
  for (const [position, input] of data.ingredients.entries()) {
    const ingredient = await tx.ingredient.upsert({
      where: {
        householdId_normalizedName: {
          householdId: data.householdId,
          normalizedName: normalizedName(input.name),
        },
      },
      create: {
        householdId: data.householdId,
        name: input.name.trim(),
        normalizedName: normalizedName(input.name),
      },
      update: {},
    });
    const unitName = input.unit.trim();
    const unit = unitName
      ? await tx.unit.upsert({
          where: {
            householdId_normalizedName: {
              householdId: data.householdId,
              normalizedName: normalizedName(unitName),
            },
          },
          create: {
            householdId: data.householdId,
            name: unitName,
            normalizedName: normalizedName(unitName),
            ...unitDefinition(unitName),
          },
          update: {},
        })
      : null;
    const createdIngredient = await tx.recipeIngredient.create({
      data: {
        recipeId,
        position,
        ingredientId: ingredient.id,
        unitId: unit?.id,
        groupId: groupIds.get(normalizedName(input.group)),
        amount: input.amount,
        note: input.note.trim(),
      },
    });
    ingredientRows.push(createdIngredient.id);
  }
  for (const [position, step] of data.steps.entries()) {
    const indexes = step.ingredientIndexes ?? [];
    if (
      indexes.some(
        (index) =>
          !Number.isInteger(index) ||
          index < 0 ||
          index >= ingredientRows.length,
      )
    )
      throw new RecipeError(400, "Ungültige Zutat am Rezeptschritt.");
    await tx.recipeStep.create({
      data: {
        recipeId,
        position,
        instruction: step.instruction.trim(),
        durationSeconds: step.durationSeconds,
        ingredients: {
          create: indexes.map((index) => ({
            ingredientId: ingredientRows[index],
          })),
        },
      },
    });
  }
  if (data.allergens !== undefined) {
    await tx.recipeAllergen.deleteMany({ where: { recipeId } });
    await tx.recipeAllergen.createMany({
      data: uniqueLabels(data.allergens).map((name) => ({ recipeId, name })),
    });
  }
  if (data.nutrition === null)
    await tx.recipeNutrition.deleteMany({ where: { recipeId } });
  else if (data.nutrition)
    await tx.recipeNutrition.upsert({
      where: { recipeId },
      create: { recipeId, ...data.nutrition },
      update: data.nutrition,
    });
  const linkedTags = new Set<string>();
  for (const name of uniqueLabels(data.tags)) {
    const tag = await tx.tag.upsert({
      where: {
        householdId_normalizedName: {
          householdId: data.householdId,
          normalizedName: normalizedName(name),
        },
      },
      create: {
        householdId: data.householdId,
        name,
        normalizedName: normalizedName(name),
      },
      update: {},
    });
    if (!linkedTags.has(tag.id)) {
      await tx.recipeTag.create({ data: { recipeId, tagId: tag.id } });
      linkedTags.add(tag.id);
    }
  }
  const linkedCategories = new Set<string>();
  for (const name of uniqueLabels(data.categories)) {
    const category = await tx.category.upsert({
      where: {
        householdId_normalizedName: {
          householdId: data.householdId,
          normalizedName: normalizedName(name),
        },
      },
      create: {
        householdId: data.householdId,
        name,
        normalizedName: normalizedName(name),
      },
      update: {},
    });
    if (!linkedCategories.has(category.id)) {
      await tx.recipeCategory.create({
        data: { recipeId, categoryId: category.id },
      });
      linkedCategories.add(category.id);
    }
  }
}
export async function saveRecipeTx(
  tx: Prisma.TransactionClient,
  userId: string,
  data: RecipeInput,
  id?: string,
  revision?: number,
) {
  if (id && !Number.isInteger(revision))
    throw new RecipeError(400, "Eine gültige Revision ist erforderlich.");
  if (id) {
    const existing = await tx.recipe.findUnique({
      where: { id },
      select: { householdId: true },
    });
    if (existing && existing.householdId !== data.householdId)
      throw new RecipeError(
        400,
        "Ein Rezept kann hier nicht in einen anderen Haushalt verschoben werden.",
      );
  }
  await lockHousehold(tx, data.householdId);
  await membership(tx, userId, data.householdId, true);
  const fields = {
    title: data.title.trim(),
    description: data.description.trim(),
    servings: data.servings,
    prepMinutes: data.prepMinutes,
    cookMinutes: data.cookMinutes,
    difficulty: data.difficulty,
    vegetarian: data.vegetarian || data.vegan,
    vegan: data.vegan,
    source: data.source.trim(),
    sourceUrl: data.sourceUrl.trim(),
    notes: data.notes.trim(),
  };
  let recipeId: string;
  if (id) {
    // Serialize aggregate writes before reading its rows under READ COMMITTED.
    const { row, canEdit } = await lockRecipe(tx, userId, id, false, true);
    const visibility = data.visibility ?? row.visibility;
    if (visibility !== row.visibility && row.creatorId !== userId)
      throw new RecipeError(
        403,
        "Nur der Ersteller darf die Sichtbarkeit ändern.",
      );
    if (visibility !== row.visibility) {
      await tx.recipeGrant.deleteMany({ where: { recipeId: id } });
      await tx.recipePublication.updateMany({
        where: { recipeId: id, publishedAt: { not: null } },
        data: { publishedAt: null, revision: { increment: 1 } },
      });
    }
    if (row.householdId !== data.householdId)
      throw new RecipeError(
        400,
        "Ein Rezept kann hier nicht in einen anderen Haushalt verschoben werden.",
      );
    const changed = await tx.recipe.updateMany({
      where: { id, revision, deletedAt: null },
      data: { ...fields, visibility, revision: { increment: 1 } },
    });
    if (!changed.count)
      throw new RecipeError(
        409,
        "Dieses Rezept wurde inzwischen geändert. Bitte neu laden, bevor du speicherst.",
      );
    await tx.recipeVersion.create({
      data: {
        recipeId: id,
        authorId: userId,
        revision: row.revision,
        snapshot: JSON.parse(
          JSON.stringify(detailDto(row, userId, canEdit)),
        ) as Prisma.InputJsonValue,
      },
    });
    await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });
    await tx.recipeIngredientGroup.deleteMany({ where: { recipeId: id } });
    await tx.recipeStep.deleteMany({ where: { recipeId: id } });
    await tx.recipeTag.deleteMany({ where: { recipeId: id } });
    await tx.recipeCategory.deleteMany({ where: { recipeId: id } });
    recipeId = id;
  } else {
    const row = await tx.recipe.create({
      data: {
        ...fields,
        visibility: data.visibility ?? "HOUSEHOLD",
        householdId: data.householdId,
        creatorId: userId,
      },
    });
    recipeId = row.id;
  }
  await writeRelations(tx, recipeId, data);
  return readRecipe(tx, userId, recipeId);
}
export async function saveRecipe(
  db: PrismaClient,
  userId: string,
  data: RecipeInput,
  id?: string,
  revision?: number,
) {
  return db.$transaction((tx) => saveRecipeTx(tx, userId, data, id, revision), {
    maxWait: 10000,
    timeout: 20000,
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  });
}

export async function setDeleted(
  db: PrismaClient,
  userId: string,
  id: string,
  revision: number,
  restore: boolean,
) {
  return db.$transaction(
    async (tx) => {
      const { row, canEdit } = await lockRecipe(tx, userId, id, true, true);
      if (Boolean(row.deletedAt) !== restore)
        throw new RecipeError(
          409,
          "Der Rezeptstatus wurde inzwischen geändert.",
        );
      const result = await tx.recipe.updateMany({
        where: { id, revision },
        data: {
          deletedAt: restore ? null : new Date(),
          revision: { increment: 1 },
        },
      });
      if (!result.count)
        throw new RecipeError(
          409,
          "Dieses Rezept wurde inzwischen geändert. Bitte neu laden.",
        );
      if (!restore)
        await tx.recipePublication.updateMany({
          where: { recipeId: id, publishedAt: { not: null } },
          data: { publishedAt: null, revision: { increment: 1 } },
        });
      await tx.recipeVersion.create({
        data: {
          recipeId: id,
          authorId: userId,
          revision: row.revision,
          snapshot: JSON.parse(
            JSON.stringify(detailDto(row, userId, canEdit)),
          ) as Prisma.InputJsonValue,
        },
      });
      return readRecipe(tx, userId, id, true);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}
