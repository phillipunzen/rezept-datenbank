export interface ImportPreview {
  recipes: number;
  valid: number;
  ingredients: number;
  images: number;
  tags: number;
  entries: Array<{ title: string; warnings: string[]; error: string }>;
  notice: string;
}
export interface ImportJobSummary {
  id: string;
  status: string;
  createdAt: string;
  error: string;
}
export interface ImportJobDetail {
  id: string;
  status: string;
  visibility: "PRIVATE" | "HOUSEHOLD";
  targetBookId: string | null;
  preview: ImportPreview;
  error: string;
  results: Array<{
    position: number;
    title: string;
    status: string;
    message: string;
    recipeId: string | null;
  }>;
}
