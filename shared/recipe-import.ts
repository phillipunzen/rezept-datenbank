import type { RecipeInput } from "./recipes";
export interface RecipeImportPreview {
  draft: RecipeInput;
  imageDataUrl: string | null;
  warnings: string[];
}
