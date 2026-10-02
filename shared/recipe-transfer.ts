import type { RecipeInput, RecipeDetail } from "./recipes";
export interface RecipeDocument {
  format: "rezeptdatenbank";
  version: 1;
  recipe: RecipeInput;
  images: string[];
  devices?: Array<{
    deviceKey: "thermomix-tm6";
    steps: import("./devices").DeviceStep[];
  }>;
}
export function recipeInput(recipe: RecipeInput): RecipeInput {
  return {
    householdId: recipe.householdId,
    visibility: recipe.visibility ?? "PRIVATE",
    title: recipe.title,
    description: recipe.description,
    servings: recipe.servings,
    prepMinutes: recipe.prepMinutes,
    cookMinutes: recipe.cookMinutes,
    difficulty: recipe.difficulty,
    vegetarian: recipe.vegetarian,
    vegan: recipe.vegan,
    source: recipe.source,
    sourceUrl: recipe.sourceUrl,
    notes: recipe.notes,
    ingredients: recipe.ingredients.map((i) => ({ ...i })),
    steps: recipe.steps.map((s) => ({ ...s })),
    tags: [...recipe.tags],
    categories: [...recipe.categories],
    allergens: [...(recipe.allergens ?? [])],
    nutrition: recipe.nutrition ?? null,
  };
}
export function recipeDocument(
  recipe: RecipeDetail,
  images: string[],
): RecipeDocument {
  return {
    format: "rezeptdatenbank",
    version: 1,
    recipe: recipeInput(recipe),
    images,
    devices: recipe.deviceData
      .filter((data) => data.current)
      .map((data) => ({ deviceKey: data.deviceKey, steps: data.steps })),
  };
}
