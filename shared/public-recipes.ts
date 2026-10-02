import type { RecipeDetail } from "./recipes";
export type PublicRecipe = Pick<
  RecipeDetail,
  | "id"
  | "title"
  | "description"
  | "servings"
  | "prepMinutes"
  | "cookMinutes"
  | "ingredients"
  | "steps"
  | "images"
  | "tags"
  | "categories"
  | "vegetarian"
  | "vegan"
  | "allergens"
> & {
  nutrition: Omit<NonNullable<RecipeDetail["nutrition"]>, "source"> | null;
};
export type PublicRecipeCard = Pick<
  PublicRecipe,
  | "id"
  | "title"
  | "description"
  | "servings"
  | "prepMinutes"
  | "cookMinutes"
  | "tags"
  | "categories"
  | "vegetarian"
  | "vegan"
  | "images"
>;
export interface PublicCatalogResponse {
  recipes: PublicRecipeCard[];
  total: number;
  page: number;
  pageSize: number;
}
export interface RecipePublicationStatus {
  enabled: boolean;
  published: boolean;
  revision: number;
  url: string | null;
}
export interface PublicRecipeResponse {
  recipe: PublicRecipe;
  schemaOrg: Record<string, unknown>;
}
