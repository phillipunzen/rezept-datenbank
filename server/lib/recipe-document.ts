import Ajv from "ajv";
import { recipeBody } from "./recipe-schemas";
import type { RecipeInput } from "../../shared/recipes";
import type { RecipeDocument } from "../../shared/recipe-transfer";
import { deviceStepError } from "../../shared/devices";
import { RecipeError } from "./errors";
const ajv = new Ajv({ strict: false, allErrors: true });
const recipeValidator = ajv.compile<RecipeInput>(recipeBody);
export function validateRecipeInput(
  input: unknown,
): asserts input is RecipeInput {
  if (!recipeValidator(input))
    throw new RecipeError(
      400,
      "Ungültige Rezeptdatei. Titel, Zutaten, Schritte oder Werte prüfen.",
    );
  for (const step of input.steps)
    if (
      (step.ingredientIndexes ?? []).some(
        (index) => index >= input.ingredients.length,
      )
    )
      throw new RecipeError(400, "Ungültige Schritt-Zutatenzuordnung.");
}
const deviceStepSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "enabled",
    "durationSeconds",
    "temperature",
    "speed",
    "reverse",
    "mode",
  ],
  properties: {
    enabled: { type: "boolean" },
    durationSeconds: { type: ["number", "null"], minimum: 0.5, maximum: 5999 },
    temperature: {
      anyOf: [
        { type: "null" },
        { type: "string", const: "VAROMA" },
        { type: "number", minimum: 37, maximum: 120 },
      ],
    },
    speed: { type: ["number", "null"], minimum: 0.5, maximum: 10 },
    reverse: { type: "boolean" },
    mode: { type: "string", enum: ["MANUAL", "DOUGH", "TURBO"] },
  },
};
export const deviceStepsSchema = {
  type: "array",
  minItems: 1,
  maxItems: 100,
  items: deviceStepSchema,
};
const documentValidator = ajv.compile<RecipeDocument>({
  type: "object",
  additionalProperties: false,
  required: ["format", "version", "recipe", "images"],
  properties: {
    format: { type: "string", const: "rezeptdatenbank" },
    version: { type: "integer", const: 1 },
    recipe: recipeBody,
    images: {
      type: "array",
      maxItems: 8,
      items: {
        type: "string",
        maxLength: 12 * 1024 * 1024,
        pattern: "^data:image/(webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$",
      },
    },
    devices: {
      type: "array",
      maxItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["deviceKey", "steps"],
        properties: {
          deviceKey: { type: "string", const: "thermomix-tm6" },
          steps: deviceStepsSchema,
        },
      },
    },
  },
});
export function validateDocument(
  input: unknown,
): asserts input is RecipeDocument {
  if (!documentValidator(input))
    throw new RecipeError(
      400,
      "Ungültiges JSON-Format. Erwartet wird ein Rezeptdatenbank-Export Version 1.",
    );
  validateRecipeInput(input.recipe);
  let bytes = 0;
  for (const image of input.images) {
    const data = image.split(",")[1];
    const decoded = Buffer.from(data, "base64");
    if (decoded.toString("base64") !== data)
      throw new RecipeError(400, "Ungültige Bildkodierung.");
    bytes += decoded.length;
  }
  if (bytes > 16 * 1024 * 1024)
    throw new RecipeError(413, "Bilder zusammen höchstens 16 MiB.");
  for (const device of input.devices ?? []) {
    if (device.steps.length !== input.recipe.steps.length)
      throw new RecipeError(400, "Geräteschritte passen nicht zum Rezept.");
    for (const step of device.steps) {
      const error = deviceStepError(step);
      if (error) throw new RecipeError(400, error);
    }
  }
}
