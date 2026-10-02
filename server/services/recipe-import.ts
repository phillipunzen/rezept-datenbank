import { load } from "cheerio";
import {
  emptyRecipe,
  type IngredientInput,
  type RecipeInput,
} from "../../shared/recipes";
import type { RecipeImportPreview } from "../../shared/recipe-import";
import { RecipeError } from "./recipes";
import { fetchPublic, importUrl, type RemoteFetcher } from "../lib/safe-fetch";
import { normalizeImage } from "../lib/normalize-image";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : null;
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value == null ? [] : [value];
function text(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return "";
  const $ = load(value.replace(/<\s*br\s*\/?\s*>|<\/(?:p|li|div)>/gi, "\n"));
  $("script,style,iframe").remove();
  return $.root()
    .text()
    .replace(/\u00a0/g, " ")
    .replace(/[\t ]+/g, " ")
    .trim();
}
const typeName = (value: unknown, name: string) =>
  array(value).some(
    (type) =>
      typeof type === "string" &&
      type.replace(/^https?:\/\/schema.org\//, "") === name,
  );
function duration(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m =
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(
      value,
    );
  return m && m.slice(1).some(Boolean)
    ? Math.round(
        Number(m[1] ?? 0) * 86400 +
          Number(m[2] ?? 0) * 3600 +
          Number(m[3] ?? 0) * 60 +
          Number(m[4] ?? 0),
      )
    : null;
}
const fractions: Record<string, string> = {
  "¼": "1/4",
  "½": "1/2",
  "¾": "3/4",
  "⅓": "1/3",
  "⅔": "2/3",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8",
};
function amount(value: string): string | null {
  if (!value.trim()) return null;
  let n: number;
  if (value.includes("/")) {
    const m = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(value);
    if (!m || Number(m[3]) === 0) return null;
    n = Number(m[1] ?? 0) + Number(m[2]) / Number(m[3]);
  } else n = Number(value.replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n >= 100_000_000) return null;
  return n.toFixed(4).replace(/\.?0+$/, "") || "0";
}
const units: Record<string, string> = {
  g: "g",
  gr: "g",
  gramm: "g",
  gram: "g",
  grams: "g",
  grm: "g",
  kg: "kg",
  kilogramm: "kg",
  kilogram: "kg",
  kgm: "kg",
  ml: "ml",
  milliliter: "ml",
  mlt: "ml",
  l: "l",
  liter: "l",
  litre: "l",
  ltr: "l",
  tl: "TL",
  teelöffel: "TL",
  tsp: "tsp",
  teaspoons: "tsp",
  teaspoon: "tsp",
  el: "EL",
  esslöffel: "EL",
  tbsp: "tbsp",
  tablespoons: "tbsp",
  tablespoon: "tbsp",
  prise: "Prise",
  prisen: "Prise",
  pinch: "pinch",
  stück: "Stück",
  stk: "Stück",
  dose: "Dose",
  dosen: "Dose",
  bund: "Bund",
  becher: "Becher",
  tasse: "Tasse",
  cup: "cup",
  cups: "cup",
  oz: "oz",
  lb: "lb",
  lbs: "lb",
  päckchen: "Päckchen",
  pck: "Päckchen",
};
export function parseIngredient(value: unknown): IngredientInput {
  const property = object(value);
  if (property) {
    const name = text(property.name);
    const unit = text(property.unitText ?? property.unitCode);
    return {
      name: name.slice(0, 150),
      amount: amount(text(property.value)),
      unit: (units[unit.toLowerCase()] ?? unit).slice(0, 24),
      group: "",
      note: "",
    };
  }
  const raw = text(value).replace(/\s+/g, " ");
  const expanded = raw
    .replace(/(\d)([¼½¾⅓⅔⅛⅜⅝⅞])/g, "$1 $2")
    .replace(/[¼½¾⅓⅔⅛⅜⅝⅞]/g, (fraction) => fractions[fraction]);
  const m = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?)\s*(.*)$/.exec(expanded);
  const fallback = {
    name: raw.slice(0, 150),
    amount: null,
    unit: "",
    group: "",
    note: raw.length > 150 ? raw.slice(0, 250) : "",
  };
  if (!m || /^[–—-]|^bis\b|^to\b|^oder\b|^or\b/i.test(m[2]) || !m[2])
    return fallback;
  const quantity = amount(m[1]);
  if (quantity === null) return fallback;
  let name = m[2].trim();
  let unit = "";
  const unitMatch = /^([^\s.]+)\.?\s+(.+)$/.exec(name);
  if (unitMatch && units[unitMatch[1].toLowerCase()]) {
    unit = units[unitMatch[1].toLowerCase()];
    name = unitMatch[2];
  }
  // Packaging and alternatives can change the meaning; preserve their full original text.
  if (/^\(?\d|^[–—-]|^x\s*\d/i.test(name)) return fallback;
  return {
    name: name.slice(0, 150),
    amount: quantity,
    unit,
    group: "",
    note: name.length > 150 ? raw.slice(0, 250) : "",
  };
}

export function extractRecipe(
  html: string,
  sourceUrl: string,
  householdId: string,
): {
  draft: RecipeInput;
  warnings: string[];
  imageUrls: string[];
} {
  const $ = load(html);
  const nodes: ObjectValue[] = [];
  function visit(value: unknown, depth = 0) {
    if (depth > 20 || nodes.length >= 2000) return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, depth + 1);
      return;
    }
    const node = object(value);
    if (!node) return;
    nodes.push(node);
    for (const child of Object.values(node))
      if (typeof child === "object") visit(child, depth + 1);
  }
  $("script").each((_index, element) => {
    if (
      ($(element).attr("type") ?? "").split(";")[0].trim().toLowerCase() !==
      "application/ld+json"
    )
      return;
    try {
      visit(
        JSON.parse(
          $(element)
            .text()
            .replace(/^\s*<!--|-->\s*$/g, ""),
        ),
      );
    } catch {
      /* Try remaining scripts and Microdata. */
    }
  });
  const byId = new Map<string, ObjectValue>();
  for (const node of nodes)
    if (typeof node["@id"] === "string") {
      const previous = byId.get(node["@id"]);
      if (!previous || Object.keys(node).length > Object.keys(previous).length)
        byId.set(node["@id"], node);
    }
  const resolve = (value: unknown): unknown => {
    const node = object(value);
    return node &&
      typeof node["@id"] === "string" &&
      Object.keys(node).length === 1
      ? (byId.get(node["@id"]) ?? value)
      : value;
  };
  const candidates = nodes.filter((node) => typeName(node["@type"], "Recipe"));
  let recipe =
    candidates.find(
      (node) => array(node.recipeIngredient).length && node.recipeInstructions,
    ) ?? candidates[0];
  if (!recipe) {
    const scope = $('[itemscope][itemtype*="schema.org/Recipe"]').first();
    if (scope.length) {
      const values = (property: string) =>
        scope
          .find(`[itemprop~="${property}"]`)
          .map((_i, element) => {
            const el = $(element);
            return (
              el.attr("content") ??
              el.attr("datetime") ??
              el.attr("src") ??
              el.attr("href") ??
              (property === "recipeInstructions"
                ? (el.html() ?? el.text())
                : el.text())
            );
          })
          .get();
      recipe = {
        name: values("name")[0],
        description: values("description")[0],
        recipeIngredient: values("recipeIngredient"),
        recipeInstructions: values("recipeInstructions"),
        recipeYield: values("recipeYield")[0],
        prepTime: values("prepTime")[0],
        cookTime: values("cookTime")[0],
        image: values("image"),
        recipeCategory: values("recipeCategory"),
        keywords: values("keywords"),
      };
    }
  }
  if (!recipe || !text(recipe.name))
    throw new RecipeError(
      422,
      "Auf dieser Seite wurden keine lesbaren Rezeptdaten gefunden. Verwende den direkten Rezept-Link; Seiten mit Anmeldung oder nur dynamisch geladenen Daten werden derzeit nicht unterstützt.",
    );
  const warnings: string[] = [];
  if (candidates.length > 1)
    warnings.push(
      "Die Seite enthält mehrere Rezepte. Das erste vollständige Rezept wurde übernommen; bitte den Titel prüfen.",
    );
  const draft = emptyRecipe(householdId);
  const bounded = (value: unknown, max: number, label: string) => {
    const str = text(value);
    if (str.length > max)
      warnings.push(`${label} wurde wegen der Länge gekürzt.`);
    return str.slice(0, max);
  };
  draft.title = bounded(recipe.name, 200, "Der Titel");
  draft.description = bounded(recipe.description, 10000, "Die Beschreibung");
  draft.sourceUrl = sourceUrl;
  draft.source = (
    text(object(resolve(recipe.publisher))?.name) || new URL(sourceUrl).hostname
  ).slice(0, 250);
  const yieldText = text(array(recipe.recipeYield)[0]);
  const yieldNumber = /\d+/.exec(yieldText);
  const servings = yieldNumber ? Number(yieldNumber[0]) : 0;
  if (servings >= 1 && servings <= 1000) draft.servings = servings;
  else
    warnings.push(
      "Die Portionszahl fehlt oder ist unklar. Bitte prüfen (vorläufig 4 Portionen).",
    );
  const prep = duration(recipe.prepTime),
    cook = duration(recipe.cookTime),
    total = duration(recipe.totalTime);
  draft.prepMinutes = Math.min(10080, Math.ceil((prep ?? 0) / 60));
  draft.cookMinutes = Math.min(
    10080,
    Math.ceil((cook ?? Math.max(0, (total ?? 0) - (prep ?? 0))) / 60),
  );
  const ingredients = array(recipe.recipeIngredient ?? recipe.ingredients)
    .map((value) => parseIngredient(resolve(value)))
    .filter((i) => i.name);
  if (ingredients.length > 100)
    warnings.push("Es wurden nur die ersten 100 Zutaten übernommen.");
  if (ingredients.length) draft.ingredients = ingredients.slice(0, 100);
  else warnings.push("Es wurden keine Zutaten gefunden. Bitte ergänzen.");
  if (ingredients.some((i) => i.amount === null))
    warnings.push(
      "Einige Mengen sind unklar oder frei formuliert. Die ursprünglichen Zutatenzeilen bleiben erhalten; bitte prüfen.",
    );
  const instructions: string[] = [];
  function steps(value: unknown, heading = "", depth = 0) {
    if (depth > 15 || instructions.length > 100) return;
    for (const raw of array(value)) {
      const resolved = resolve(raw);
      const node = object(resolved);
      if (node) {
        if (typeName(node["@type"], "HowToSection") || node.itemListElement) {
          steps(node.itemListElement, text(node.name) || heading, depth + 1);
        } else if (node.item) steps(node.item, heading, depth + 1);
        else {
          const instruction = text(node.text ?? node.description ?? node.name);
          if (instruction)
            instructions.push(
              heading ? `${heading}: ${instruction}` : instruction,
            );
        }
      } else {
        for (const line of text(resolved)
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean))
          instructions.push(heading ? `${heading}: ${line}` : line);
      }
    }
  }
  steps(recipe.recipeInstructions);
  if (instructions.length > 100)
    warnings.push("Es wurden nur die ersten 100 Schritte übernommen.");
  if (instructions.length)
    draft.steps = instructions.slice(0, 100).map((s) => ({
      instruction: bounded(s, 10000, "Ein Schritt"),
      durationSeconds: null,
    }));
  else
    warnings.push(
      "Es wurden keine Zubereitungsschritte gefunden. Bitte ergänzen.",
    );
  const labels = (value: unknown, max: number) =>
    [
      ...new Set(
        array(value)
          .flatMap((v) => text(v).split(","))
          .map((s) => s.trim().slice(0, 80))
          .filter(Boolean),
      ),
    ].slice(0, max);
  draft.categories = labels(recipe.recipeCategory, 10);
  draft.tags = labels(recipe.keywords, 20);
  const diets = array(recipe.suitableForDiet).map(text).join(" ");
  draft.vegan = /VeganDiet/i.test(diets);
  draft.vegetarian = draft.vegan || /VegetarianDiet/i.test(diets);
  const imageUrls: string[] = [];
  for (const value of array(recipe.image)) {
    const node = object(resolve(value));
    const candidate = text(node ? (node.contentUrl ?? node.url) : value);
    if (candidate) {
      try {
        imageUrls.push(new URL(candidate, sourceUrl).href);
      } catch {
        /* Invalid candidate. */
      }
    }
  }
  if (!imageUrls.length) {
    const og = $('meta[property="og:image"]').first().attr("content");
    if (og) {
      try {
        imageUrls.push(new URL(og, sourceUrl).href);
      } catch {
        /* No image. */
      }
    }
  }
  return {
    draft,
    warnings: [...new Set(warnings)],
    imageUrls: [...new Set(imageUrls)].slice(0, 3),
  };
}

export async function importRecipeUrl(
  value: string,
  householdId: string,
  fetcher: RemoteFetcher = fetchPublic,
): Promise<RecipeImportPreview> {
  const url = importUrl(value);
  const signal = AbortSignal.timeout(25_000);
  try {
    const page = await fetcher(url.href, 3 * 1024 * 1024, signal);
    if (!["text/html", "application/xhtml+xml"].includes(page.contentType))
      throw new RecipeError(422, "Der Link liefert keine Rezept-Webseite.");
    const result = extractRecipe(
      page.body.toString("utf8"),
      page.url,
      householdId,
    );
    let imageDataUrl: string | null = null;
    for (const candidate of result.imageUrls) {
      try {
        importUrl(candidate);
        const image = await fetcher(candidate, 8 * 1024 * 1024, signal);
        const output = await normalizeImage(image.body, image.contentType);
        imageDataUrl = `data:image/webp;base64,${output.toString("base64")}`;
        break;
      } catch {
        /* A missing/blocked image must not discard a readable recipe. */
      }
    }
    if (!imageDataUrl)
      result.warnings.push(
        result.imageUrls.length
          ? "Das Rezeptbild konnte nicht übernommen werden. Du kannst nach dem Speichern ein Bild hinzufügen."
          : "Auf der Seite wurde kein Rezeptbild gefunden.",
      );
    return { draft: result.draft, imageDataUrl, warnings: result.warnings };
  } catch (error) {
    if (error instanceof RecipeError) throw error;
    if (signal.aborted)
      throw new RecipeError(
        504,
        "Die Website antwortet zu langsam. Bitte später erneut versuchen.",
      );
    throw new RecipeError(
      422,
      "Die Website konnte nicht abgerufen werden. Prüfe den Link und versuche es erneut.",
    );
  }
}
