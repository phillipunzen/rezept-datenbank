import { ApiError } from "../api";
import type { RecipeDetail } from "../../../shared/recipes";
export interface Metadata {
  tags: string[];
  categories: string[];
  ingredients: string[];
  units: string[];
}
export async function uploadImage(recipe: RecipeDetail, file: File) {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(
    `/api/v1/recipes/${recipe.id}/images?revision=${recipe.revision}`,
    { method: "POST", body, credentials: "same-origin" },
  );
  const data = (await response.json()) as {
    recipe?: RecipeDetail;
    message?: string;
  };
  if (!response.ok)
    throw new ApiError(
      data.message ?? "Upload fehlgeschlagen.",
      response.status,
    );
  if (!data.recipe) throw new Error("Ungültige Antwort.");
  return data.recipe;
}
