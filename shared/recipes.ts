export interface IngredientInput {
  name: string;
  amount: string | null;
  unit: string;
  group: string;
  note: string;
}
export interface StepInput {
  instruction: string;
  durationSeconds: number | null;
  ingredientIndexes?: number[];
}
export interface NutritionInput {
  calories: string | null;
  carbohydrates: string | null;
  fats: string | null;
  proteins: string | null;
  basis: "SERVING" | "RECIPE" | "UNKNOWN";
  source: string;
}
export interface RecipeInput {
  householdId: string;
  visibility?: "HOUSEHOLD" | "PRIVATE";
  title: string;
  description: string;
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  vegetarian: boolean;
  vegan: boolean;
  source: string;
  sourceUrl: string;
  notes: string;
  ingredients: IngredientInput[];
  steps: StepInput[];
  tags: string[];
  categories: string[];
  allergens?: string[];
  nutrition?: NutritionInput | null;
}
export interface RecipeImage {
  id: string;
  url: string;
}
export interface RecipeSummary {
  id: string;
  householdId: string;
  visibility: "HOUSEHOLD" | "PRIVATE";
  title: string;
  description: string;
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  difficulty: RecipeInput["difficulty"];
  vegetarian: boolean;
  vegan: boolean;
  source: string;
  sourceUrl: string;
  notes: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  creatorName: string;
  images: RecipeImage[];
  tags: string[];
  categories: string[];
  favorite: boolean;
  rating: number | null;
  averageRating: number | null;
  ratingCount: number;
  canEdit: boolean;
  canManageAccess: boolean;
  canManagePublicLinks: boolean;
  missingIngredients?: string[];
}
export interface RecipeDetail extends RecipeSummary {
  allergens: string[];
  nutrition: NutritionInput | null;
  deviceData: import("./devices").DeviceData[];
  ingredients: IngredientInput[];
  steps: StepInput[];
}
export interface RecipePage {
  recipes: RecipeSummary[];
  total: number;
  page: number;
  pageSize: number;
}
export function normalizedName(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("de-DE");
}
// Fixed-point arithmetic preserves decimal quantities and avoids floating-point artifacts.
export function scaleAmount(
  amount: string | null,
  original: number,
  target: number,
): string | null {
  if (amount === null || amount === "") return null;
  if (
    !/^\d{1,8}(\.\d{1,4})?$/.test(amount) ||
    !Number.isSafeInteger(original) ||
    !Number.isSafeInteger(target) ||
    original < 1 ||
    target < 1 ||
    target > 1000
  )
    throw new Error("Ungültige Mengen oder Portionen.");
  const [whole, fraction = ""] = amount.split(".");
  const fixed = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, "0"));
  const numerator = fixed * BigInt(target);
  const denominator = BigInt(original);
  const scaled = (numerator + denominator / 2n) / denominator;
  const result = `${scaled / 10000n}.${String(scaled % 10000n).padStart(4, "0")}`;
  return result.replace(/\.?0+$/, "");
}
export function unitDefinition(name: string) {
  const normalized = normalizedName(name);
  if (["g", "kg"].includes(normalized))
    return {
      dimension: "MASS",
      baseFactor: normalized === "kg" ? "1000" : "1",
    };
  if (["ml", "l"].includes(normalized))
    return {
      dimension: "VOLUME",
      baseFactor: normalized === "l" ? "1000" : "1",
    };
  return {
    dimension: ["stück", "stueck", "stk"].includes(normalized)
      ? "COUNT"
      : "OTHER",
    baseFactor: null,
  };
}
export function emptyRecipe(householdId: string): RecipeInput {
  return {
    householdId,
    visibility: "HOUSEHOLD",
    title: "",
    description: "",
    servings: 4,
    prepMinutes: 0,
    cookMinutes: 0,
    difficulty: "EASY",
    vegetarian: false,
    vegan: false,
    source: "",
    sourceUrl: "",
    notes: "",
    ingredients: [{ name: "", amount: null, unit: "g", group: "", note: "" }],
    steps: [{ instruction: "", durationSeconds: null }],
    tags: [],
    categories: [],
  };
}
