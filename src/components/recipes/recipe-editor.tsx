"use client";
import { useRef, useState } from "react";
import { ArrowLeft, Plus, Save } from "lucide-react";
import type {
  RecipeInput,
  IngredientInput,
  StepInput,
  RecipeDetail,
} from "../../../shared/recipes";
import { emptyRecipe } from "../../../shared/recipes";
import type { Locale } from "../translations";
import { recipeMessages } from "./messages";
import { SortControls, dropRow, moveItem } from "./sort-controls";
import type { Metadata } from "./api";
interface IngredientRow extends IngredientInput {
  key: string;
}
interface StepRow extends StepInput {
  key: string;
  ingredientKeys: string[];
}
export function RecipeEditor({
  householdId,
  recipe,
  initialDraft,
  locale,
  metadata,
  busy,
  error,
  onSave,
  onCancel,
  onDirty,
}: {
  householdId: string;
  recipe: RecipeDetail | null;
  initialDraft?: RecipeInput | null;
  locale: Locale;
  metadata: Metadata;
  busy: boolean;
  error: string;
  onSave: (data: RecipeInput) => Promise<void>;
  onCancel: () => void;
  onDirty: () => void;
}) {
  const t = recipeMessages[locale];
  const initial = recipe ?? initialDraft ?? emptyRecipe(householdId);
  // Row keys only identify local form rows; they do not need browser crypto APIs.
  const nextRowKey = useRef(0);
  const [draft, setDraft] = useState<RecipeInput>(initial);
  const [ingredients, setIngredients] = useState<IngredientRow[]>(() =>
    initial.ingredients.map((i, index) => ({
      ...i,
      key: `ingredient-${index}`,
    })),
  );
  const [steps, setSteps] = useState<StepRow[]>(() =>
    initial.steps.map((i, index) => ({
      ...i,
      key: `step-${index}`,
      ingredientKeys: (i.ingredientIndexes ?? []).map(
        (index) => `ingredient-${index}`,
      ),
    })),
  );
  const [tags, setTags] = useState(initial.tags.join(", "));
  const [allergens, setAllergens] = useState(
    (initial.allergens ?? []).join(", "),
  );
  const [categories, setCategories] = useState(initial.categories.join(", "));
  const update = <K extends keyof RecipeInput>(
    key: K,
    value: RecipeInput[K],
  ) => {
    onDirty();
    setDraft((previous) => ({ ...previous, [key]: value }));
  };
  const updateIngredient = (index: number, patch: Partial<IngredientInput>) => {
    onDirty();
    setIngredients((items) =>
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  };
  const updateStep = (index: number, patch: Partial<StepInput>) => {
    onDirty();
    setSteps((items) =>
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  };
  const moveIngredient = (from: number, to: number) => {
    onDirty();
    setIngredients((items) => moveItem(items, from, to));
  };
  const moveStep = (from: number, to: number) => {
    onDirty();
    setSteps((items) => moveItem(items, from, to));
  };
  const labels = (value: string) =>
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSave({
      ...draft,
      ingredients: ingredients.map(({ key: _key, ...row }) => ({
        ...row,
        amount: row.amount?.trim().replace(",", ".") || null,
      })),
      steps: steps.map(({ key: _key, ingredientKeys, ...row }) => ({
        ...row,
        ingredientIndexes: ingredientKeys
          .map((key) => ingredients.findIndex((i) => i.key === key))
          .filter((index) => index >= 0)
          .sort((a, b) => a - b),
      })),
      allergens: labels(allergens),
      tags: labels(tags),
      categories: labels(categories),
    });
  }
  return (
    <form className="recipe-editor" onSubmit={submit}>
      <div className="recipe-editor-heading">
        <button
          type="button"
          className="text-button"
          onClick={onCancel}
          disabled={busy}
        >
          <ArrowLeft size={16} />
          {t.back}
        </button>
        <h1>{recipe ? t.edit : t.newRecipe}</h1>
        <p className="muted">{t.uploadAfterSave}</p>
      </div>
      <fieldset disabled={busy}>
        <section className="panel editor-basics">
          <label>
            {t.recipeTitle}
            <input
              name="title"
              value={draft.title}
              onChange={(event) => update("title", event.target.value)}
              maxLength={200}
              placeholder={t.titlePlaceholder}
              required
            />
          </label>
          <label>
            {t.description}
            <textarea
              name="description"
              value={draft.description}
              onChange={(event) => update("description", event.target.value)}
              maxLength={10000}
              rows={3}
              placeholder={t.descriptionPlaceholder}
            />
          </label>
          <div className="editor-grid">
            <label>
              {t.servings}
              <input
                name="servings"
                type="number"
                min={1}
                max={1000}
                value={draft.servings}
                onChange={(event) =>
                  update("servings", Number(event.target.value))
                }
                required
              />
            </label>
            <label>
              {t.prep}
              <input
                name="prepMinutes"
                type="number"
                min={0}
                max={10080}
                value={draft.prepMinutes}
                onChange={(event) =>
                  update("prepMinutes", Number(event.target.value))
                }
                required
              />
            </label>
            <label>
              {t.cook}
              <input
                name="cookMinutes"
                type="number"
                min={0}
                max={10080}
                value={draft.cookMinutes}
                onChange={(event) =>
                  update("cookMinutes", Number(event.target.value))
                }
                required
              />
            </label>
            <label>
              {t.difficulty}
              <select
                aria-label={t.difficulty}
                value={draft.difficulty}
                onChange={(event) =>
                  update(
                    "difficulty",
                    event.target.value as RecipeInput["difficulty"],
                  )
                }
              >
                <option value="EASY">{t.easy}</option>
                <option value="MEDIUM">{t.medium}</option>
                <option value="HARD">{t.hard}</option>
              </select>
            </label>
          </div>
          <div className="inline-checks">
            <label>
              <input
                type="checkbox"
                checked={draft.vegetarian || draft.vegan}
                onChange={(event) => update("vegetarian", event.target.checked)}
                disabled={draft.vegan}
              />
              {t.vegetarian}
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.vegan}
                onChange={(event) => update("vegan", event.target.checked)}
              />
              {t.vegan}
            </label>
          </div>
          <label>
            {t.visibility}
            <select
              aria-label={t.visibility}
              value={draft.visibility ?? "HOUSEHOLD"}
              disabled={Boolean(recipe && !recipe.canManageAccess)}
              onChange={(event) =>
                update(
                  "visibility",
                  event.target.value as "HOUSEHOLD" | "PRIVATE",
                )
              }
            >
              <option value="HOUSEHOLD">{t.householdVisibility}</option>
              <option value="PRIVATE">{t.privateVisibility}</option>
            </select>
            <small>{t.visibilityHint}</small>
          </label>
        </section>
        <section className="panel editor-section">
          <div className="section-heading">
            <h2>{t.ingredients}</h2>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                onDirty();
                const key = `row-${nextRowKey.current++}`;
                setIngredients((items) => [
                  ...items,
                  {
                    key,
                    name: "",
                    amount: null,
                    unit: "",
                    group: "",
                    note: "",
                  },
                ]);
              }}
              disabled={ingredients.length >= 100}
            >
              <Plus size={16} />
              {t.addIngredient}
            </button>
          </div>
          <datalist id="ingredient-options">
            {metadata.ingredients.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <datalist id="unit-options">
            {[
              ...new Set([
                "g",
                "kg",
                "ml",
                "l",
                "TL",
                "EL",
                "Stück",
                "Prise",
                "Bund",
                "Dose",
                ...metadata.units,
              ]),
            ].map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {ingredients.map((row, index) => (
            <div
              className="ingredient-editor-row"
              key={row.key}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) =>
                dropRow(event, "ingredient", index, moveIngredient)
              }
            >
              <div className="row-top">
                <span className="row-number">{index + 1}</span>
                <SortControls
                  index={index}
                  total={ingredients.length}
                  kind="ingredient"
                  locale={locale}
                  move={moveIngredient}
                  remove={() => {
                    onDirty();
                    setIngredients((items) =>
                      items.filter((_, i) => i !== index),
                    );
                  }}
                />
              </div>
              <div className="ingredient-fields">
                <label>
                  {t.amount}
                  <input
                    aria-label={`${t.amount} ${index + 1}`}
                    inputMode="decimal"
                    pattern="[0-9]{1,8}([.,][0-9]{1,4})?"
                    value={row.amount ?? ""}
                    onChange={(event) =>
                      updateIngredient(index, {
                        amount: event.target.value || null,
                      })
                    }
                  />
                </label>
                <label>
                  {t.unit}
                  <input
                    aria-label={`${t.unit} ${index + 1}`}
                    list="unit-options"
                    maxLength={24}
                    value={row.unit}
                    onChange={(event) =>
                      updateIngredient(index, { unit: event.target.value })
                    }
                  />
                </label>
                <label>
                  {t.ingredient}
                  <input
                    aria-label={`${t.ingredient} ${index + 1}`}
                    list="ingredient-options"
                    maxLength={150}
                    required
                    value={row.name}
                    onChange={(event) =>
                      updateIngredient(index, { name: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="ingredient-extra">
                <label>
                  {t.group}
                  <input
                    aria-label={`${t.group} ${index + 1}`}
                    maxLength={120}
                    placeholder={t.groupPlaceholder}
                    value={row.group}
                    onChange={(event) =>
                      updateIngredient(index, { group: event.target.value })
                    }
                  />
                </label>
                <label>
                  {t.ingredientNote}
                  <input
                    aria-label={`${t.ingredientNote} ${index + 1}`}
                    maxLength={250}
                    value={row.note}
                    onChange={(event) =>
                      updateIngredient(index, { note: event.target.value })
                    }
                  />
                </label>
              </div>
            </div>
          ))}
        </section>
        <section className="panel editor-section">
          <div className="section-heading">
            <h2>{t.steps}</h2>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                onDirty();
                const key = `row-${nextRowKey.current++}`;
                setSteps((items) => [
                  ...items,
                  {
                    key,
                    instruction: "",
                    durationSeconds: null,
                    ingredientKeys: [],
                  },
                ]);
              }}
              disabled={steps.length >= 100}
            >
              <Plus size={16} />
              {t.addStep}
            </button>
          </div>
          {steps.map((row, index) => (
            <div
              className="step-editor-row"
              key={row.key}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropRow(event, "step", index, moveStep)}
            >
              <div className="row-top">
                <strong>
                  {t.steps} {index + 1}
                </strong>
                <SortControls
                  index={index}
                  total={steps.length}
                  kind="step"
                  locale={locale}
                  move={moveStep}
                  remove={() => {
                    onDirty();
                    setSteps((items) => items.filter((_, i) => i !== index));
                  }}
                />
              </div>
              <label>
                {t.instruction}
                <textarea
                  aria-label={`${t.instruction} ${index + 1}`}
                  rows={3}
                  maxLength={10000}
                  required
                  placeholder={t.stepPlaceholder}
                  value={row.instruction}
                  onChange={(event) =>
                    updateStep(index, { instruction: event.target.value })
                  }
                />
              </label>
              <details className="step-ingredients">
                <summary>
                  {locale === "de"
                    ? "Zutaten dieses Schritts"
                    : "Ingredients for this step"}
                </summary>
                {ingredients.map((ingredient) => (
                  <label className="ingredient-checkbox" key={ingredient.key}>
                    <input
                      type="checkbox"
                      checked={row.ingredientKeys.includes(ingredient.key)}
                      aria-label={`${locale === "de" ? "Schritt" : "Step"} ${index + 1} ${ingredient.name || (locale === "de" && "Zutat") || "Ingredient"}`}
                      onChange={(event) => {
                        onDirty();
                        const checked = event.target.checked;
                        setSteps((items) =>
                          items.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  ingredientKeys: checked
                                    ? [...item.ingredientKeys, ingredient.key]
                                    : item.ingredientKeys.filter(
                                        (key) => key !== ingredient.key,
                                      ),
                                }
                              : item,
                          ),
                        );
                      }}
                    />
                    {ingredient.name || "—"}
                  </label>
                ))}
              </details>
              <label className="step-duration">
                {t.duration}
                <input
                  aria-label={`${t.duration} ${index + 1}`}
                  type="number"
                  min={0}
                  max={604800}
                  value={row.durationSeconds ?? ""}
                  onChange={(event) =>
                    updateStep(index, {
                      durationSeconds:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    })
                  }
                />
              </label>
            </div>
          ))}
        </section>
        <section className="panel editor-section">
          <h2>
            {locale === "de"
              ? "Allergene und Nährwerte"
              : "Allergens and nutrition"}
          </h2>
          <label>
            {locale === "de"
              ? "Allergene (durch Komma getrennt)"
              : "Allergens (comma-separated)"}
            <input
              value={allergens}
              maxLength={2430}
              onChange={(event) => {
                onDirty();
                setAllergens(event.target.value);
              }}
            />
          </label>
          <label className="ingredient-checkbox">
            <input
              type="checkbox"
              checked={Boolean(draft.nutrition)}
              onChange={(event) =>
                update(
                  "nutrition",
                  event.target.checked
                    ? {
                        calories: null,
                        carbohydrates: null,
                        fats: null,
                        proteins: null,
                        basis: "SERVING",
                        source: "",
                      }
                    : null,
                )
              }
            />
            {locale === "de" ? "Nährwerte angeben" : "Add nutrition"}
          </label>
          {draft.nutrition && (
            <div className="editor-grid two">
              <label>
                {locale === "de" ? "Bezugsgröße" : "Basis"}
                <select
                  aria-label={locale === "de" ? "Bezugsgröße" : "Basis"}
                  value={draft.nutrition.basis}
                  onChange={(event) =>
                    update("nutrition", {
                      ...draft.nutrition!,
                      basis: event.target.value as
                        "SERVING" | "RECIPE" | "UNKNOWN",
                    })
                  }
                >
                  <option value="SERVING">
                    {locale === "de" ? "Pro Portion" : "Per serving"}
                  </option>
                  <option value="RECIPE">
                    {locale === "de" ? "Gesamtes Rezept" : "Whole recipe"}
                  </option>
                  <option value="UNKNOWN">
                    {locale === "de" ? "Nicht angegeben" : "Unspecified"}
                  </option>
                </select>
              </label>
              {(["calories", "carbohydrates", "fats", "proteins"] as const).map(
                (key) => (
                  <label key={key}>
                    {
                      {
                        calories:
                          locale === "de" ? "Energie (kcal)" : "Energy (kcal)",
                        carbohydrates:
                          locale === "de"
                            ? "Kohlenhydrate (g)"
                            : "Carbohydrates (g)",
                        fats: locale === "de" ? "Fett (g)" : "Fat (g)",
                        proteins:
                          locale === "de" ? "Eiweiß (g)" : "Protein (g)",
                      }[key]
                    }
                    <input
                      inputMode="decimal"
                      pattern="[0-9]{1,8}([.,][0-9]{1,2})?"
                      value={draft.nutrition![key] ?? ""}
                      onChange={(event) =>
                        update("nutrition", {
                          ...draft.nutrition!,
                          [key]: event.target.value.replace(",", ".") || null,
                        })
                      }
                    />
                  </label>
                ),
              )}
              <label>
                {locale === "de" ? "Quelle der Nährwerte" : "Nutrition source"}
                <input
                  maxLength={250}
                  value={draft.nutrition.source}
                  onChange={(event) =>
                    update("nutrition", {
                      ...draft.nutrition!,
                      source: event.target.value,
                    })
                  }
                />
              </label>
            </div>
          )}
        </section>
        <section className="panel editor-section">
          <h2>{t.more}</h2>
          <div className="editor-grid two">
            <label>
              {t.categories}
              <input
                value={categories}
                onChange={(event) => {
                  onDirty();
                  setCategories(event.target.value);
                }}
                maxLength={810}
              />
            </label>
            <label>
              {t.tags}
              <input
                value={tags}
                onChange={(event) => {
                  onDirty();
                  setTags(event.target.value);
                }}
                maxLength={1620}
              />
            </label>
            <label>
              {t.source}
              <input
                value={draft.source}
                onChange={(event) => update("source", event.target.value)}
                maxLength={250}
              />
            </label>
            <label>
              {t.sourceUrl}
              <input
                type="url"
                value={draft.sourceUrl}
                onChange={(event) => update("sourceUrl", event.target.value)}
                maxLength={2048}
                placeholder="https://…"
              />
            </label>
          </div>
          <label>
            {t.notes}
            <textarea
              rows={3}
              value={draft.notes}
              onChange={(event) => update("notes", event.target.value)}
              maxLength={10000}
            />
          </label>
        </section>
      </fieldset>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <div className="editor-actions">
        <button
          type="button"
          className="button secondary"
          onClick={onCancel}
          disabled={busy}
        >
          {t.cancel}
        </button>
        <button className="button primary" disabled={busy}>
          <Save size={17} />
          {busy ? t.saving : t.save}
        </button>
      </div>
    </form>
  );
}
