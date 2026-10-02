import { normalizedName, scaleAmount, unitDefinition } from "./recipes";
export type MealSlot = "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK";
export interface RecipeReference {
  id: string;
  title: string;
  imageUrl: string | null;
  servings: number;
  visibility: "HOUSEHOLD" | "PRIVATE";
}
export interface Cookbook {
  id: string;
  name: string;
  description: string;
  revision: number;
  recipes: RecipeReference[];
}
export interface PlanEntry {
  id: string;
  date: string;
  slot: MealSlot;
  servings: number;
  revision: number;
  recipe: RecipeReference;
}
export interface ShoppingItem {
  id: string;
  name: string;
  amount: string | null;
  unit: string;
  note: string;
  checked: boolean;
}
export interface ShoppingList {
  id: string;
  name: string;
  revision: number;
  items: ShoppingItem[];
}
export interface CookingEvent {
  id: string;
  cookedAt: string;
  servings: number;
  note: string;
  recipe: RecipeReference;
}
export interface IngredientQuantity {
  name: string;
  amount: string | null;
  unit: string;
  note: string;
}
export function fixedAmount(amount: string): bigint {
  if (!/^\d{1,16}(\.\d{1,4})?$/.test(amount))
    throw new Error("Ungültige Menge.");
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, "0"));
}
export function decimalAmount(fixed: bigint): string {
  if (fixed < 0n || fixed >= 100000000000000000000n)
    throw new Error("Menge ist zu groß.");
  return `${fixed / 10000n}.${String(fixed % 10000n).padStart(4, "0")}`.replace(
    /\.?0+$/,
    "",
  );
}
export function normalizedQuantity(
  item: IngredientQuantity,
  original = 1,
  target = 1,
) {
  const definition = unitDefinition(item.unit);
  const amount =
    item.amount === null
      ? null
      : original === target
        ? decimalAmount(fixedAmount(item.amount))
        : scaleAmount(item.amount, original, target);
  const unit =
    definition.dimension === "MASS"
      ? "g"
      : definition.dimension === "VOLUME"
        ? "ml"
        : definition.dimension === "COUNT"
          ? "Stück"
          : item.unit.trim();
  const base =
    amount === null
      ? null
      : decimalAmount(
          fixedAmount(amount) * BigInt(definition.baseFactor ?? "1"),
        );
  return {
    ...item,
    name: item.name.trim(),
    unit,
    amount: base,
    key: `${normalizedName(item.name)}|${normalizedName(unit)}|${base === null ? "unknown" : "known"}`,
  };
}
export function displayQuantity(
  amount: string | null,
  unit: string,
  locale: string,
): string {
  if (amount === null) return unit;
  const fixed = fixedAmount(amount);
  const larger = (unit === "g" || unit === "ml") && fixed >= 10000000n;
  const value = Number(amount) / (larger ? 1000 : 1);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value)} ${larger ? (unit === "g" ? "kg" : "l") : unit}`.trim();
}
