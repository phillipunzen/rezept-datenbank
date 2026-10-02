import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  Cookbook,
  RecipeReference,
  PlanEntry,
  ShoppingList,
  CookingEvent,
  IngredientQuantity,
  MealSlot,
} from "../../shared/planning";
import {
  normalizedQuantity,
  fixedAmount,
  decimalAmount,
} from "../../shared/planning";
import { lockHousehold, membership, type Db } from "./household-access";
import { recipeRow, lockRecipe, visibleRecipeWhere } from "./recipes";
import { RecipeError } from "../lib/errors";
const options = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
};
const visible = (userId: string) => ({
  ...visibleRecipeWhere(userId),
  deletedAt: null,
});
export function recipeReference(row: {
  id: string;
  title: string;
  servings: number;
  visibility: string;
  images: { id: string }[];
}): RecipeReference {
  return {
    id: row.id,
    title: row.title,
    servings: row.servings,
    visibility: row.visibility as RecipeReference["visibility"],
    imageUrl: row.images[0]
      ? `/api/v1/recipes/${row.id}/images/${row.images[0].id}`
      : null,
  };
}
const imageInclude = {
  images: { orderBy: { createdAt: "asc" as const }, take: 1 },
};
export function calendarDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new RecipeError(400, "Ungültiges Datum.");
  return date;
}
export async function cookbooks(
  db: Db,
  userId: string,
  householdId: string,
): Promise<Cookbook[]> {
  await membership(db, userId, householdId);
  const books = await db.cookbook.findMany({
    where: { householdId },
    orderBy: { name: "asc" },
    include: {
      recipes: {
        where: { recipe: visible(userId) },
        orderBy: { createdAt: "asc" },
        include: { recipe: { include: imageInclude } },
      },
    },
  });
  return books.map((book) => ({
    id: book.id,
    name: book.name,
    description: book.description,
    revision: book.revision,
    recipes: book.recipes.map((link) => recipeReference(link.recipe)),
  }));
}
export async function createBook(
  db: PrismaClient,
  userId: string,
  householdId: string,
  name: string,
  description: string,
) {
  return db.$transaction(async (tx) => {
    await lockHousehold(tx, householdId);
    await membership(tx, userId, householdId, true);
    if ((await tx.cookbook.count({ where: { householdId } })) >= 200)
      throw new RecipeError(400, "Höchstens 200 Rezeptbücher pro Haushalt.");
    return tx.cookbook.create({
      data: { householdId, creatorId: userId, name: name.trim(), description },
    });
  }, options);
}
async function bookWrite(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
  revision: number,
) {
  const initial = await tx.cookbook.findUnique({ where: { id } });
  if (!initial) throw new RecipeError(404, "Rezeptbuch nicht gefunden.");
  await lockHousehold(tx, initial.householdId);
  await membership(tx, userId, initial.householdId, true);
  const book = await tx.cookbook.findUnique({ where: { id } });
  if (!book) throw new RecipeError(404, "Rezeptbuch nicht gefunden.");
  if (book.revision !== revision)
    throw new RecipeError(
      409,
      "Das Rezeptbuch wurde geändert. Bitte neu laden.",
    );
  return book;
}
export async function mutateBook(
  db: PrismaClient,
  userId: string,
  id: string,
  revision: number,
  change:
    | { name: string; description: string }
    | { recipeId: string; remove?: boolean }
    | null,
) {
  return db.$transaction(async (tx) => {
    const book = await bookWrite(tx, userId, id, revision);
    if (!change) {
      await tx.cookbook.delete({ where: { id } });
      return;
    }
    if ("recipeId" in change) {
      const { row } = await recipeRow(tx, userId, change.recipeId);
      if (row.householdId !== book.householdId)
        throw new RecipeError(
          400,
          "Rezept und Rezeptbuch gehören zu verschiedenen Haushalten.",
        );
      if (change.remove)
        await tx.cookbookRecipe.deleteMany({
          where: { cookbookId: id, recipeId: row.id },
        });
      else
        await tx.cookbookRecipe.upsert({
          where: { cookbookId_recipeId: { cookbookId: id, recipeId: row.id } },
          create: { cookbookId: id, recipeId: row.id },
          update: {},
        });
      return tx.cookbook.update({
        where: { id },
        data: { revision: { increment: 1 } },
      });
    }
    return tx.cookbook.update({
      where: { id },
      data: {
        name: change.name.trim(),
        description: change.description,
        revision: { increment: 1 },
      },
    });
  }, options);
}
export async function plan(
  db: Db,
  userId: string,
  householdId: string,
  from: string,
  to: string,
): Promise<PlanEntry[]> {
  await membership(db, userId, householdId);
  const start = calendarDate(from),
    end = calendarDate(to);
  if (end < start || end.getTime() - start.getTime() > 31 * 86400000)
    throw new RecipeError(400, "Höchstens 32 Tage pro Planabruf.");
  const rows = await db.mealPlanEntry.findMany({
    where: {
      householdId,
      date: { gte: start, lte: end },
      recipe: visible(userId),
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: { recipe: { include: imageInclude } },
  });
  return rows.map((row) => ({
    id: row.id,
    date: row.date.toISOString().slice(0, 10),
    slot: row.slot as MealSlot,
    servings: row.servings,
    revision: row.revision,
    recipe: recipeReference(row.recipe),
  }));
}
export async function createPlanEntry(
  db: PrismaClient,
  userId: string,
  input: {
    householdId: string;
    recipeId: string;
    date: string;
    slot: MealSlot;
    servings: number;
  },
) {
  return db.$transaction(async (tx) => {
    await lockHousehold(tx, input.householdId);
    await membership(tx, userId, input.householdId, true);
    const { row } = await recipeRow(tx, userId, input.recipeId);
    if (row.householdId !== input.householdId)
      throw new RecipeError(400, "Rezept gehört zu einem anderen Haushalt.");
    if (
      (await tx.mealPlanEntry.count({
        where: {
          householdId: input.householdId,
          date: calendarDate(input.date),
        },
      })) >= 100
    )
      throw new RecipeError(400, "Höchstens 100 Mahlzeiten pro Tag.");
    return tx.mealPlanEntry.create({
      data: { ...input, date: calendarDate(input.date), creatorId: userId },
    });
  }, options);
}
export async function mutatePlanEntry(
  db: PrismaClient,
  userId: string,
  id: string,
  revision: number,
  change: { date: string; slot: MealSlot; servings: number } | null,
) {
  return db.$transaction(async (tx) => {
    const initial = await tx.mealPlanEntry.findUnique({ where: { id } });
    if (!initial) throw new RecipeError(404, "Mahlzeit nicht gefunden.");
    await lockHousehold(tx, initial.householdId);
    await membership(tx, userId, initial.householdId, true);
    const row = await tx.mealPlanEntry.findUnique({ where: { id } });
    if (!row) throw new RecipeError(404, "Mahlzeit nicht gefunden.");
    await recipeRow(tx, userId, row.recipeId);
    if (row.revision !== revision)
      throw new RecipeError(
        409,
        "Die Mahlzeit wurde geändert. Bitte neu laden.",
      );
    if (!change) {
      await tx.mealPlanEntry.delete({ where: { id } });
      return;
    }
    const targetDate = calendarDate(change.date);
    if (
      targetDate.getTime() !== row.date.getTime() &&
      (await tx.mealPlanEntry.count({
        where: { householdId: row.householdId, date: targetDate },
      })) >= 100
    )
      throw new RecipeError(400, "Höchstens 100 Mahlzeiten pro Tag.");
    return tx.mealPlanEntry.update({
      where: { id },
      data: {
        ...change,
        date: calendarDate(change.date),
        revision: { increment: 1 },
      },
    });
  }, options);
}
export async function shoppingLists(
  db: Db,
  userId: string,
  householdId: string,
): Promise<ShoppingList[]> {
  await membership(db, userId, householdId);
  const rows = await db.shoppingList.findMany({
    where: { householdId },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        orderBy: [{ checked: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    revision: row.revision,
    items: row.items.map((item) => ({
      id: item.id,
      name: item.name,
      amount: item.amount?.toString() ?? null,
      unit: item.unit,
      note: item.note,
      checked: item.checked,
    })),
  }));
}
export async function createList(
  db: PrismaClient,
  userId: string,
  householdId: string,
  name: string,
) {
  return db.$transaction(async (tx) => {
    await lockHousehold(tx, householdId);
    await membership(tx, userId, householdId, true);
    if ((await tx.shoppingList.count({ where: { householdId } })) >= 100)
      throw new RecipeError(400, "Höchstens 100 Einkaufslisten pro Haushalt.");
    return tx.shoppingList.create({
      data: { householdId, creatorId: userId, name: name.trim() },
    });
  }, options);
}
async function listWrite(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
  revision: number,
) {
  const first = await tx.shoppingList.findUnique({ where: { id } });
  if (!first) throw new RecipeError(404, "Einkaufsliste nicht gefunden.");
  await lockHousehold(tx, first.householdId);
  await membership(tx, userId, first.householdId, true);
  const list = await tx.shoppingList.findUnique({ where: { id } });
  if (!list) throw new RecipeError(404, "Einkaufsliste nicht gefunden.");
  if (list.revision !== revision)
    throw new RecipeError(
      409,
      "Die Liste wurde auf einem anderen Gerät geändert. Bitte neu laden.",
    );
  return list;
}
const bumpList = (tx: Prisma.TransactionClient, id: string) =>
  tx.shoppingList.update({
    where: { id },
    data: { revision: { increment: 1 } },
  });
async function addQuantities(
  tx: Prisma.TransactionClient,
  listId: string,
  ingredients: IngredientQuantity[],
  original = 1,
  target = 1,
) {
  for (const ingredient of ingredients) {
    let item: ReturnType<typeof normalizedQuantity>;
    try {
      item = normalizedQuantity(ingredient, original, target);
    } catch {
      throw new RecipeError(
        400,
        "Die berechnete Menge ist zu groß oder ungültig.",
      );
    }
    const existing = await tx.shoppingListItem.findFirst({
      where: { listId, mergeKey: item.key, checked: false },
      orderBy: { createdAt: "asc" },
    });
    if (existing) {
      let amount: string | null = null;
      try {
        amount =
          item.amount === null
            ? null
            : decimalAmount(
                fixedAmount(existing.amount!.toString()) +
                  fixedAmount(item.amount),
              );
      } catch {
        throw new RecipeError(400, "Die summierte Menge ist zu groß.");
      }
      const note = Array.from(
        new Set([existing.note, item.note].filter(Boolean)),
      ).join("\n");
      if (note.length > 2000)
        throw new RecipeError(400, "Zu viele zusammengefasste Notizen.");
      await tx.shoppingListItem.update({
        where: { id: existing.id },
        data: { amount, note },
      });
    } else {
      if ((await tx.shoppingListItem.count({ where: { listId } })) >= 1000)
        throw new RecipeError(
          400,
          "Höchstens 1000 Einträge pro Einkaufsliste.",
        );
      await tx.shoppingListItem.create({
        data: {
          listId,
          name: item.name,
          amount: item.amount,
          unit: item.unit,
          note: item.note,
          mergeKey: item.key,
        },
      });
    }
  }
}
export async function mutateList(
  db: PrismaClient,
  userId: string,
  id: string,
  revision: number,
  change: { name: string } | null,
) {
  return db.$transaction(async (tx) => {
    await listWrite(tx, userId, id, revision);
    if (!change) {
      await tx.shoppingList.delete({ where: { id } });
      return;
    }
    return tx.shoppingList.update({
      where: { id },
      data: { name: change.name.trim(), revision: { increment: 1 } },
    });
  }, options);
}
export async function addManualItem(
  db: PrismaClient,
  userId: string,
  id: string,
  revision: number,
  item: IngredientQuantity,
) {
  return db.$transaction(async (tx) => {
    await listWrite(tx, userId, id, revision);
    await addQuantities(tx, id, [item]);
    return bumpList(tx, id);
  }, options);
}
export async function mutateItem(
  db: PrismaClient,
  userId: string,
  id: string,
  itemId: string,
  revision: number,
  change:
    (IngredientQuantity & { checked: boolean }) | { checked: boolean } | null,
) {
  return db.$transaction(async (tx) => {
    await listWrite(tx, userId, id, revision);
    const item = await tx.shoppingListItem.findFirst({
      where: { id: itemId, listId: id },
    });
    if (!item) throw new RecipeError(404, "Listeneintrag nicht gefunden.");
    if (!change) await tx.shoppingListItem.delete({ where: { id: itemId } });
    else if ("name" in change) {
      let normalized: ReturnType<typeof normalizedQuantity>;
      try {
        normalized = normalizedQuantity(change);
      } catch {
        throw new RecipeError(400, "Menge ungültig.");
      }
      await tx.shoppingListItem.update({
        where: { id: itemId },
        data: {
          name: normalized.name,
          amount: normalized.amount,
          unit: normalized.unit,
          note: normalized.note,
          mergeKey: normalized.key,
          checked: change.checked,
        },
      });
    } else
      await tx.shoppingListItem.update({
        where: { id: itemId },
        data: { checked: change.checked },
      });
    return bumpList(tx, id);
  }, options);
}
export async function addRecipeToList(
  db: PrismaClient,
  userId: string,
  id: string,
  revision: number,
  recipeId: string,
  servings: number,
  sharePrivate: boolean,
) {
  return db.$transaction(async (tx) => {
    const list = await listWrite(tx, userId, id, revision);
    const { row } = await recipeRow(tx, userId, recipeId);
    if (row.householdId !== list.householdId)
      throw new RecipeError(400, "Rezept gehört zu einem anderen Haushalt.");
    if (row.visibility === "PRIVATE" && !sharePrivate)
      throw new RecipeError(
        400,
        "Bitte bestätigen, dass private Zutaten auf der gemeinsamen Liste sichtbar werden.",
      );
    await addQuantities(
      tx,
      id,
      row.ingredients.map((i) => ({
        name: i.ingredient.name,
        amount: i.amount?.toString() ?? null,
        unit: i.unit?.name ?? "",
        note: i.note,
      })),
      row.servings,
      servings,
    );
    return bumpList(tx, id);
  }, options);
}
export async function addPlanToList(
  db: PrismaClient,
  userId: string,
  id: string,
  revision: number,
  from: string,
  to: string,
  sharePrivate: boolean,
) {
  return db.$transaction(
    async (tx) => {
      const list = await listWrite(tx, userId, id, revision);
      const entries = await plan(tx, userId, list.householdId, from, to);
      if (!entries.length)
        throw new RecipeError(
          400,
          "Keine sichtbaren Mahlzeiten im gewählten Zeitraum.",
        );
      for (const entry of entries) {
        const { row } = await recipeRow(tx, userId, entry.recipe.id);
        if (row.visibility === "PRIVATE" && !sharePrivate)
          throw new RecipeError(
            400,
            "Bitte bestätigen, dass private Zutaten auf der gemeinsamen Liste sichtbar werden.",
          );
        await addQuantities(
          tx,
          id,
          row.ingredients.map((i) => ({
            name: i.ingredient.name,
            amount: i.amount?.toString() ?? null,
            unit: i.unit?.name ?? "",
            note: i.note,
          })),
          row.servings,
          entry.servings,
        );
      }
      return bumpList(tx, id);
    },
    { ...options, timeout: 20000 },
  );
}
export async function cookingHistory(
  db: Db,
  userId: string,
  householdId: string,
): Promise<CookingEvent[]> {
  await membership(db, userId, householdId);
  const rows = await db.cookingHistory.findMany({
    where: { userId, recipe: { householdId, ...visible(userId) } },
    orderBy: [{ cookedAt: "desc" }, { id: "desc" }],
    take: 100,
    include: { recipe: { include: imageInclude } },
  });
  return rows.map((row) => ({
    id: row.id,
    cookedAt: row.cookedAt.toISOString(),
    servings: row.servings,
    note: row.note,
    recipe: recipeReference(row.recipe),
  }));
}
export async function completeCooking(
  db: PrismaClient,
  userId: string,
  recipeId: string,
  servings: number,
  note: string,
  requestKey: string,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`;
    await lockRecipe(tx, userId, recipeId);
    const existing = await tx.cookingHistory.findUnique({
      where: { userId_requestKey: { userId, requestKey } },
    });
    if (existing) {
      if (
        existing.recipeId !== recipeId ||
        existing.servings !== servings ||
        existing.note !== note
      )
        throw new RecipeError(
          409,
          "Dieser Kochvorgang wurde bereits mit anderen Angaben gespeichert.",
        );
      return existing;
    }
    return tx.cookingHistory.create({
      data: { userId, recipeId, servings, note, requestKey },
    });
  }, options);
}
export async function deleteCookingEvent(
  db: PrismaClient,
  userId: string,
  id: string,
) {
  const result = await db.cookingHistory.deleteMany({ where: { id, userId } });
  if (!result.count) throw new RecipeError(404, "Kochvorgang nicht gefunden.");
}
