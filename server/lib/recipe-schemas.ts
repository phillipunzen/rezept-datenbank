const text = (maxLength: number) => ({ type: "string", maxLength });
export const nutritionSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  required: [
    "calories",
    "carbohydrates",
    "fats",
    "proteins",
    "basis",
    "source",
  ],
  properties: {
    ...Object.fromEntries(
      ["calories", "carbohydrates", "fats", "proteins"].map((key) => [
        key,
        {
          anyOf: [
            { type: "null" },
            {
              type: "string",
              pattern: "^\\d{1,8}(\\.\\d{1,2})?$",
              maxLength: 11,
            },
          ],
        },
      ]),
    ),
    basis: { type: "string", enum: ["SERVING", "RECIPE", "UNKNOWN"] },
    source: text(250),
  },
};
const nonempty = (maxLength: number) => ({
  ...text(maxLength),
  minLength: 1,
  pattern: "\\S",
});
export const recipeProperties = {
  householdId: nonempty(30),
  visibility: { type: "string", enum: ["HOUSEHOLD", "PRIVATE"] },
  title: nonempty(200),
  description: text(10000),
  servings: { type: "integer", minimum: 1, maximum: 1000 },
  prepMinutes: { type: "integer", minimum: 0, maximum: 10080 },
  cookMinutes: { type: "integer", minimum: 0, maximum: 10080 },
  difficulty: { type: "string", enum: ["EASY", "MEDIUM", "HARD"] },
  vegetarian: { type: "boolean" },
  vegan: { type: "boolean" },
  source: text(250),
  sourceUrl: {
    type: "string",
    maxLength: 2048,
    pattern: "^(https?://[^\\s]+)?$",
  },
  notes: text(10000),
  ingredients: {
    type: "array",
    minItems: 1,
    maxItems: 100,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["name", "amount", "unit", "group", "note"],
      properties: {
        name: nonempty(150),
        amount: {
          anyOf: [
            { type: "null" },
            {
              type: "string",
              pattern: "^\\d{1,8}(\\.\\d{1,4})?$",
              maxLength: 13,
            },
          ],
        },
        unit: text(24),
        group: text(120),
        note: text(250),
      },
    },
  },
  steps: {
    type: "array",
    minItems: 1,
    maxItems: 100,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["instruction", "durationSeconds"],
      properties: {
        instruction: nonempty(10000),
        ingredientIndexes: {
          type: "array",
          uniqueItems: true,
          maxItems: 100,
          items: { type: "integer", minimum: 0, maximum: 99 },
        },
        durationSeconds: {
          anyOf: [
            { type: "null" },
            { type: "integer", minimum: 0, maximum: 604800 },
          ],
        },
      },
    },
  },
  tags: { type: "array", maxItems: 20, items: nonempty(80) },
  categories: { type: "array", maxItems: 10, items: nonempty(80) },
  allergens: { type: "array", maxItems: 30, items: nonempty(80) },
  nutrition: nutritionSchema,
};
export const recipeBody = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(recipeProperties).filter(
    (key) => !["visibility", "allergens", "nutrition"].includes(key),
  ),
  properties: recipeProperties,
};
export const recipeUpdate = {
  ...recipeBody,
  required: [...recipeBody.required, "revision"],
  properties: {
    ...recipeProperties,
    revision: { type: "integer", minimum: 1 },
  },
};
export const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: nonempty(30) },
};
export const revisionQuery = {
  type: "object",
  required: ["revision"],
  properties: { revision: { type: "integer", minimum: 1 } },
};
export const listQuery = {
  type: "object",
  required: ["householdId"],
  properties: {
    householdId: nonempty(30),
    q: text(120),
    tag: text(80),
    category: text(80),
    favorites: { type: "boolean" },
    vegetarian: { type: "boolean" },
    vegan: { type: "boolean" },
    trash: { type: "boolean" },
    maxMinutes: { type: "integer", minimum: 0, maximum: 20160 },
    minRating: { type: "number", minimum: 1, maximum: 5 },
    availableIngredients: text(2000),
    maxMissing: { type: "integer", minimum: 0, maximum: 100 },
    thermomix: { type: "boolean" },
    page: { type: "integer", minimum: 1, maximum: 100000 },
    pageSize: { type: "integer", minimum: 1, maximum: 48 },
  },
};
const image = {
  type: "object",
  properties: { id: text(30), url: text(250) },
  required: ["id", "url"],
};
export const summary = {
  type: "object",
  properties: {
    ...Object.fromEntries(
      Object.entries(recipeProperties).filter(
        ([key]) => !["ingredients", "steps"].includes(key),
      ),
    ),
    id: text(30),
    revision: { type: "integer" },
    createdAt: text(40),
    updatedAt: text(40),
    deletedAt: { type: ["string", "null"] },
    creatorName: text(120),
    images: { type: "array", items: image },
    favorite: { type: "boolean" },
    rating: { type: ["integer", "null"] },
    averageRating: { type: ["number", "null"] },
    ratingCount: { type: "integer" },
    canEdit: { type: "boolean" },
    canManageAccess: { type: "boolean" },
    canManagePublicLinks: { type: "boolean" },
    missingIngredients: { type: "array", items: text(150) },
  },
};
export const detailResponse = {
  type: "object",
  properties: {
    recipe: {
      ...summary,
      properties: {
        ...summary.properties,
        ingredients: recipeProperties.ingredients,
        steps: recipeProperties.steps,
        allergens: recipeProperties.allergens,
        nutrition: nutritionSchema,
        deviceData: {
          type: "array",
          items: { type: "object", additionalProperties: true },
        },
      },
    },
  },
};
export const pageResponse = {
  type: "object",
  properties: {
    recipes: { type: "array", items: summary },
    total: { type: "integer" },
    page: { type: "integer" },
    pageSize: { type: "integer" },
  },
};
