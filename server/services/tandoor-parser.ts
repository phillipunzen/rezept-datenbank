import { createHash } from "node:crypto";
import { emptyRecipe, type RecipeInput } from "../../shared/recipes";
import { validateRecipeInput } from "../lib/recipe-document";
import { readZip, zipBudget } from "../lib/safe-zip";
import { RecipeError } from "../lib/errors";
export interface TandoorEntry {
  title: string;
  draft: RecipeInput | null;
  image: Buffer | null;
  imageMime: string | null;
  contentHash: string;
  warnings: string[];
  error: string;
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RecipeError(400, "Ungültiger Tandoor-Datensatz.");
  return value as Record<string, unknown>;
};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const array = (value: unknown) => (Array.isArray(value) ? value : []);
function decimal(value: unknown, places: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  const input = String(value);
  if (!/^\d{1,8}(\.\d{1,12})?$/.test(input))
    throw new RecipeError(400, "Ungültige Dezimalmenge im Export.");
  const [whole, fraction = ""] = input.split(".");
  const scale = 10n ** BigInt(places);
  let fixed =
    BigInt(whole) * scale +
    BigInt(fraction.slice(0, places).padEnd(places, "0"));
  if (Number(fraction[places] ?? 0) >= 5) fixed++;
  if (fixed / scale >= 100000000n)
    throw new RecipeError(400, "Menge überschreitet das unterstützte Format.");
  return (
    `${fixed / scale}.${String(fixed % scale).padStart(places, "0")}`.replace(
      /\.?0+$/,
      "",
    ) || "0"
  );
}
const plain = (input: string) =>
  input
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(?:p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .trim();
export function decodeTandoor(
  input: unknown,
  householdId: string,
): { draft: RecipeInput; warnings: string[] } {
  const data = record(input),
    draft = emptyRecipe(householdId),
    warnings: string[] = [];
  draft.visibility = "PRIVATE";
  draft.title = text(data.name);
  draft.description = plain(text(data.description));
  draft.servings =
    typeof data.servings === "number"
      ? data.servings
      : Number(data.servings ?? 4);
  draft.prepMinutes = Number(data.working_time ?? 0);
  draft.cookMinutes = Number(data.waiting_time ?? 0);
  draft.source = "Tandoor";
  draft.sourceUrl = text(data.source_url);
  draft.ingredients = [];
  draft.steps = [];
  draft.tags = array(data.keywords).map((k) => text(record(k).name));
  draft.categories = [];
  if (data.servings_text)
    draft.notes = `Portionsangabe aus Tandoor: ${text(data.servings_text)}`;
  const steps = array(data.steps)
    .map(record)
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
  for (const step of steps) {
    let group = text(step.name);
    const indexes: number[] = [];
    for (const ingredient of array(step.ingredients)
      .map(record)
      .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))) {
      const food = ingredient.food ? record(ingredient.food) : {};
      if (ingredient.is_header === true) {
        group = text(food.name) || text(ingredient.note);
        continue;
      }
      const name = text(food.name);
      if (!name.trim())
        throw new RecipeError(400, "Zutat ohne Namen im Export.");
      const raw = ingredient.no_amount === true ? null : ingredient.amount;
      const amount = decimal(raw, 4);
      if (
        raw !== null &&
        raw !== undefined &&
        String(raw).includes(".") &&
        /[1-9]/.test(String(raw).split(".")[1].slice(4))
      )
        warnings.push(`Menge für ${name} auf vier Nachkommastellen gerundet.`);
      indexes.push(draft.ingredients.length);
      draft.ingredients.push({
        name,
        amount,
        unit: ingredient.unit ? text(record(ingredient.unit).name) : "",
        group,
        note: text(ingredient.note),
      });
    }
    const instruction = [text(step.name), plain(text(step.instruction))]
      .filter(Boolean)
      .join("\n");
    if (!instruction && !indexes.length) continue;
    const time = Number(step.time ?? 0);
    draft.steps.push({
      instruction: instruction || "Zutaten vorbereiten.",
      durationSeconds: time > 0 ? time * 60 : null,
      ingredientIndexes: indexes,
    });
  }
  if (data.nutrition) {
    const nutrition = record(data.nutrition);
    draft.nutrition = {
      calories: decimal(nutrition.calories, 2),
      carbohydrates: decimal(nutrition.carbohydrates, 2),
      fats: decimal(nutrition.fats, 2),
      proteins: decimal(nutrition.proteins, 2),
      basis: "UNKNOWN",
      source: text(nutrition.source),
    };
    warnings.push(
      "Bezugsgröße der Nährwerte im Export nicht angegeben; bitte im Editor prüfen.",
    );
  }
  validateRecipeInput(draft);
  return { draft, warnings: [...new Set(warnings)] };
}
export async function parseTandoor(
  buffer: Buffer,
  householdId: string,
): Promise<TandoorEntry[]> {
  if (buffer.length > 64 * 1024 * 1024)
    throw new RecipeError(413, "ZIP höchstens 64 MiB.");
  const budget = zipBudget();
  const outer = await readZip(buffer, budget);
  const containers = outer.has("recipe.json")
    ? [["recipe.zip", outer] as const]
    : [...outer.entries()].filter(([name]) =>
        name.toLowerCase().endsWith(".zip"),
      );
  if (!containers.length || containers.length > 1000)
    throw new RecipeError(
      400,
      "Erwartet wird der Tandoor-Default-Export mit höchstens 1000 Rezepten.",
    );
  const result: TandoorEntry[] = [];
  for (const [name, content] of containers) {
    const entry: TandoorEntry = {
      title: name.slice(0, 200),
      draft: null,
      image: null,
      imageMime: null,
      contentHash: "",
      warnings: [],
      error: "",
    };
    try {
      const files =
        content instanceof Map
          ? content
          : await readZip(content, budget, 8 * 1024 * 1024);
      const json = files.get("recipe.json");
      if (!json || json.length > 1024 * 1024)
        throw new RecipeError(
          400,
          "recipe.json fehlt oder ist größer als 1 MiB.",
        );
      const decoded = decodeTandoor(
        JSON.parse(json.toString("utf8")),
        householdId,
      );
      Object.assign(entry, decoded);
      entry.title = decoded.draft.title;
      const images = [...files.entries()].filter(([key]) =>
        /^image\.(png|jpe?g|webp)$/i.test(key),
      );
      if (images.length) {
        const [filename, image] = images[0];
        entry.image = image;
        entry.imageMime = /\.png$/i.test(filename)
          ? "image/png"
          : /\.webp$/i.test(filename)
            ? "image/webp"
            : "image/jpeg";
      }
      if (images.length > 1)
        entry.warnings.push(
          "Nur das erste Rezeptbild des Default-Exports wird übernommen.",
        );
      entry.contentHash = createHash("sha256")
        .update(JSON.stringify({ ...decoded.draft, householdId: "" }))
        .update(entry.image ?? Buffer.alloc(0))
        .digest("hex");
    } catch (error) {
      if (
        error instanceof RecipeError &&
        (error.statusCode === 413 ||
          /Unsicher|Doppelte|Links im ZIP|Verschlüsselte/.test(error.message))
      )
        throw error;
      entry.error =
        error instanceof RecipeError
          ? error.message
          : "Beschädigter Rezeptdatensatz.";
      entry.draft = null;
    }
    result.push(entry);
  }
  return result;
}
export function tandoorPreview(entries: TandoorEntry[]) {
  return {
    recipes: entries.length,
    valid: entries.filter((e) => e.draft).length,
    ingredients: entries.reduce(
      (n, e) => n + (e.draft?.ingredients.length ?? 0),
      0,
    ),
    images: entries.filter((e) => e.image).length,
    tags: [...new Set(entries.flatMap((e) => e.draft?.tags ?? []))].length,
    entries: entries.map((e) => ({
      title: e.title,
      warnings: e.warnings,
      error: e.error,
    })),
    notice:
      "Default-Exporte enthalten keine Bewertungen, Favoriten oder Rezeptbuchzuordnungen.",
  };
}
