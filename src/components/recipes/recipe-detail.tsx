"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Clock,
  Heart,
  ImagePlus,
  Minus,
  Pencil,
  Plus,
  Play,
  Printer,
  RotateCcw,
  Star,
  Trash2,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import type { RecipeDetail } from "../../../shared/recipes";
import { scaleAmount } from "../../../shared/recipes";
import { api } from "../api";
import type { Locale } from "../translations";
import { recipeMessages } from "./messages";
import { uploadImage } from "./api";
import { RecipeSharing } from "./recipe-sharing";
import { RecipeDeviceEditor } from "./recipe-device-editor";
import { RecipePublication } from "./recipe-publication";
import { RecipePublicSharing } from "./recipe-public-sharing";
import { RecipeTools } from "./recipe-tools";
import { RecipeShopping } from "./recipe-shopping";
import { RecipeCooking } from "./recipe-cooking";
import { cookingMessages } from "./cooking-messages";
export function RecipeView({
  recipe,
  locale,
  onRecipe,
  onBack,
  onEdit,
  onDeleted,
  onBusy,
  canManageLists,
  onDuplicate,
}: {
  recipe: RecipeDetail;
  locale: Locale;
  onRecipe: (recipe: RecipeDetail) => void;
  onBack: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  onBusy?: (busy: boolean) => void;
  canManageLists?: boolean;
  onDuplicate?: (recipe: RecipeDetail) => void;
}) {
  const t = recipeMessages[locale];
  const [portions, setPortions] = useState(recipe.servings);
  const [busy, setBusy] = useState(false);
  const [deviceCooking, setDeviceCooking] = useState(false);
  const currentDevice = recipe.deviceData.find(
    (data) => data.current && data.steps.some((step) => step.enabled),
  );
  const [cooking, setCooking] = useState(false);
  const [error, setError] = useState("");
  const upload = useRef<HTMLInputElement>(null);
  useEffect(() => setPortions(recipe.servings), [recipe.id, recipe.servings]);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 });
  async function action(work: () => Promise<RecipeDetail>, deleted = false) {
    setBusy(true);
    onBusy?.(true);
    setError("");
    try {
      const result = await work();
      onRecipe(result);
      if (deleted) onDeleted();
    } catch (error) {
      setError(error instanceof Error ? error.message : t.failed);
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }
  async function mutate(path: string, body?: object, method?: string) {
    return (
      await api<{ recipe: RecipeDetail }>(
        `/recipes/${recipe.id}${path}`,
        body,
        method,
      )
    ).recipe;
  }
  const groups = recipe.ingredients.reduce<
    Array<{ name: string; items: RecipeDetail["ingredients"] }>
  >((result, ingredient) => {
    let group = result.find((group) => group.name === ingredient.group);
    if (!group) {
      group = { name: ingredient.group, items: [] };
      result.push(group);
    }
    group.items.push(ingredient);
    return result;
  }, []);
  return (
    <article className="recipe-detail">
      {cooking && (
        <RecipeCooking
          recipe={recipe}
          device={deviceCooking ? currentDevice : undefined}
          portions={portions}
          locale={locale}
          onClose={() => setCooking(false)}
        />
      )}
      <div className="detail-toolbar">
        <button className="text-button" onClick={onBack} disabled={busy}>
          <ArrowLeft size={16} />
          {t.back}
        </button>
        <div className="detail-actions">
          {!recipe.deletedAt && recipe.steps.length > 0 && (
            <button
              className="button primary cooking-start"
              disabled={busy}
              onClick={() => {
                setDeviceCooking(false);
                setCooking(true);
              }}
            >
              <Play size={18} />
              {cookingMessages[locale].start}
            </button>
          )}
          {currentDevice && !recipe.deletedAt && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setDeviceCooking(true);
                setCooking(true);
              }}
            >
              Thermomix {locale === "de" ? "kochen" : "cooking"}
            </button>
          )}
          <button
            className="icon-button"
            aria-label={t.print}
            onClick={() => window.print()}
          >
            <Printer size={19} />
          </button>
          {!recipe.deletedAt && (
            <button
              className={`icon-button ${recipe.favorite ? "is-favorite" : ""}`}
              aria-label={recipe.favorite ? t.unfavorite : t.favorite}
              aria-pressed={recipe.favorite}
              disabled={busy}
              onClick={() => {
                void action(() =>
                  mutate("/favorite", { favorite: !recipe.favorite }, "PUT"),
                );
              }}
            >
              <Heart
                size={20}
                fill={recipe.favorite ? "currentColor" : "none"}
              />
            </button>
          )}
          {recipe.canEdit && !recipe.deletedAt && (
            <button className="button primary" disabled={busy} onClick={onEdit}>
              <Pencil size={16} />
              {t.edit}
            </button>
          )}
          {recipe.canEdit && recipe.deletedAt && (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => {
                void action(
                  () => mutate("/restore", { revision: recipe.revision }),
                  true,
                );
              }}
            >
              <RotateCcw size={16} />
              {t.restore}
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {recipe.deletedAt && <div className="technical-note">{t.trashHint}</div>}
      <div className="detail-cover">
        {recipe.images[0] ? (
          <img src={recipe.images[0].url} alt={recipe.title} />
        ) : (
          <div className="recipe-cover-empty">
            <UtensilsCrossed size={68} strokeWidth={1.1} />
          </div>
        )}
      </div>
      <header className="detail-heading">
        <div className="recipe-badges">
          {recipe.visibility === "PRIVATE" && (
            <span className="recipe-chip">{t.privateVisibility}</span>
          )}
          {recipe.categories.map((category) => (
            <span className="recipe-chip" key={category}>
              {category}
            </span>
          ))}
          {recipe.vegan ? (
            <span className="recipe-chip">{t.vegan}</span>
          ) : (
            recipe.vegetarian && (
              <span className="recipe-chip">{t.vegetarian}</span>
            )
          )}
        </div>
        <h1>{recipe.title}</h1>
        {recipe.description && <p>{recipe.description}</p>}
        <div className="recipe-facts">
          <span>
            <Clock size={16} />
            {recipe.prepMinutes + recipe.cookMinutes} {t.minutes} {t.total}
          </span>
          <span>
            <Users size={16} />
            {recipe.servings} {t.servings}
          </span>
          <span>
            {recipe.difficulty === "EASY"
              ? t.easy
              : recipe.difficulty === "MEDIUM"
                ? t.medium
                : t.hard}
          </span>
          {recipe.averageRating !== null && (
            <span>
              <Star size={15} />
              {number.format(recipe.averageRating)} ({recipe.ratingCount})
            </span>
          )}
        </div>
        <div className="recipe-tags">
          {recipe.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      </header>
      {canManageLists && !recipe.deletedAt && (
        <RecipeShopping recipe={recipe} portions={portions} locale={locale} />
      )}
      <div className="recipe-body-grid">
        <section className="panel detail-ingredients">
          <div className="section-heading">
            <h2>{t.ingredients}</h2>
          </div>
          <div className="portion-control">
            <label htmlFor="recipe-portions">{t.servings}</label>
            <button
              className="icon-button"
              aria-label={`${t.remove} ${t.servings}`}
              disabled={portions <= 1}
              onClick={() => setPortions((value) => value - 1)}
            >
              <Minus size={16} />
            </button>
            <input
              id="recipe-portions"
              aria-label={t.servings}
              type="number"
              min={1}
              max={1000}
              value={portions}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value >= 1 && value <= 1000)
                  setPortions(value);
              }}
            />
            <button
              className="icon-button"
              aria-label={`${t.addIngredient} ${t.servings}`}
              disabled={portions >= 1000}
              onClick={() => setPortions((value) => value + 1)}
            >
              <Plus size={16} />
            </button>
          </div>
          <p className="small muted scaling-hint">{t.scaledHint}</p>
          {groups.map((group, index) => (
            <div className="ingredient-group" key={group.name}>
              {(group.name || groups.length > 1) && (
                <h3>{group.name || t.groupUngrouped}</h3>
              )}
              <ul>
                {group.items.map((ingredient, i) => {
                  const amount = scaleAmount(
                    ingredient.amount,
                    recipe.servings,
                    portions,
                  );
                  return (
                    <li key={`${index}-${i}`}>
                      <span className="ingredient-quantity">
                        {amount !== null ? number.format(Number(amount)) : ""}{" "}
                        {ingredient.unit}
                      </span>
                      <label className="ingredient-checkbox">
                        <input
                          type="checkbox"
                          aria-label={`${ingredient.name} ${t.checkIngredient}`}
                        />
                        <span>
                          <strong>{ingredient.name}</strong>
                          {ingredient.note && <small>{ingredient.note}</small>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
        <section className="panel detail-steps">
          <h2>{t.steps}</h2>
          <ol>
            {recipe.steps.map((step, index) => (
              <li key={index}>
                <span className="step-index">{index + 1}</span>
                <div>
                  <p>{step.instruction}</p>
                  {step.durationSeconds !== null &&
                    step.durationSeconds > 0 && (
                      <span className="step-time">
                        <Clock size={13} />
                        {step.durationSeconds < 60
                          ? `${step.durationSeconds} s`
                          : `${number.format(step.durationSeconds / 60)} ${t.minutes}`}
                      </span>
                    )}
                </div>
              </li>
            ))}
          </ol>
          {recipe.notes && (
            <div className="recipe-notes">
              <h3>{t.notes}</h3>
              <p>{recipe.notes}</p>
            </div>
          )}
        </section>
      </div>
      <section className="panel recipe-secondary">
        <div className="recipe-rating">
          <h3>{t.rating}</h3>
          <div className="rating-buttons">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                className={`icon-button ${value <= (recipe.rating ?? 0) ? "selected-star" : ""}`}
                aria-label={`${value} ${locale === "de" ? "Sterne" : "stars"}`}
                aria-pressed={recipe.rating === value}
                disabled={busy || Boolean(recipe.deletedAt)}
                onClick={() => {
                  void action(() =>
                    mutate("/rating", { rating: value }, "PUT"),
                  );
                }}
              >
                <Star
                  size={23}
                  fill={value <= (recipe.rating ?? 0) ? "currentColor" : "none"}
                />
              </button>
            ))}
            {recipe.rating !== null && !recipe.deletedAt && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  void action(() => mutate("/rating", { rating: null }, "PUT"));
                }}
              >
                {t.clearRating}
              </button>
            )}
          </div>
        </div>
        <div className="recipe-source">
          {(recipe.source || recipe.sourceUrl) && (
            <>
              <h3>{t.source}</h3>
              {recipe.sourceUrl ? (
                <a href={recipe.sourceUrl} target="_blank" rel="noreferrer">
                  {recipe.source || recipe.sourceUrl} ↗
                </a>
              ) : (
                <p>{recipe.source}</p>
              )}
            </>
          )}
          <p className="small muted">
            {t.createdBy}: {recipe.creatorName} ·{" "}
            {date.format(new Date(recipe.createdAt))}
            <br />
            {t.modified}: {date.format(new Date(recipe.updatedAt))} ·{" "}
            {t.revision} {recipe.revision}
          </p>
        </div>
      </section>
      <section className="panel recipe-images">
        <div className="section-heading">
          <h2>{t.images}</h2>
          {recipe.canEdit && !recipe.deletedAt && (
            <>
              <input
                ref={upload}
                className="visually-hidden"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label={t.upload}
                disabled={busy || recipe.images.length >= 8}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void action(() => uploadImage(recipe, file));
                }}
              />
              <button
                className="button secondary"
                disabled={busy || recipe.images.length >= 8}
                onClick={() => upload.current?.click()}
              >
                <ImagePlus size={17} />
                {t.upload}
              </button>
            </>
          )}
        </div>
        <p className="small muted">{t.imageHint}</p>
        {recipe.images.length > 0 && (
          <div className="image-gallery">
            {recipe.images.map((image, index) => (
              <div key={image.id}>
                <img
                  src={image.url}
                  alt={`${recipe.title} ${index + 1}`}
                  loading="lazy"
                />
                {recipe.canEdit && !recipe.deletedAt && (
                  <button
                    className="icon-button danger"
                    aria-label={`${t.deleteImage} ${index + 1}`}
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(t.imageConfirm))
                        void action(() =>
                          mutate(
                            `/images/${image.id}?revision=${recipe.revision}`,
                            undefined,
                            "DELETE",
                          ),
                        );
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      {recipe.allergens.length > 0 && (
        <section className="panel">
          <h2>{locale === "de" ? "Allergene" : "Allergens"}</h2>
          <p>{recipe.allergens.join(", ")}</p>
        </section>
      )}
      {recipe.nutrition && (
        <section className="panel">
          <h2>{locale === "de" ? "Nährwerte" : "Nutrition"}</h2>
          <p className="small muted">
            {recipe.nutrition.basis === "SERVING"
              ? locale === "de"
                ? "Pro Portion"
                : "Per serving"
              : recipe.nutrition.basis === "RECIPE"
                ? locale === "de"
                  ? "Gesamtes Rezept"
                  : "Whole recipe"
                : locale === "de"
                  ? "Bezugsgröße nicht angegeben"
                  : "Basis unspecified"}
          </p>
          <div className="recipe-facts">
            {(["calories", "carbohydrates", "fats", "proteins"] as const).map(
              (key) =>
                recipe.nutrition![key] !== null && (
                  <span key={key}>
                    {
                      {
                        calories: locale === "de" ? "Energie" : "Energy",
                        carbohydrates:
                          locale === "de" ? "Kohlenhydrate" : "Carbohydrates",
                        fats: locale === "de" ? "Fett" : "Fat",
                        proteins: locale === "de" ? "Eiweiß" : "Protein",
                      }[key]
                    }
                    : {recipe.nutrition![key]}{" "}
                    {key === "calories" ? "kcal" : "g"}
                  </span>
                ),
            )}
          </div>
          {recipe.nutrition.source && (
            <p className="small muted">{recipe.nutrition.source}</p>
          )}
        </section>
      )}
      {!recipe.deletedAt && (
        <RecipeTools
          recipe={recipe}
          locale={locale}
          canCreate={Boolean(canManageLists)}
          onRecipe={onRecipe}
          onDuplicate={onDuplicate ?? onRecipe}
          onBusy={(value) => {
            setBusy(value);
            onBusy?.(value);
          }}
        />
      )}
      {recipe.canEdit && !recipe.deletedAt && (
        <RecipeDeviceEditor
          recipe={recipe}
          locale={locale}
          onRecipe={onRecipe}
          onBusy={(value) => {
            setBusy(value);
            onBusy?.(value);
          }}
        />
      )}
      {recipe.canManagePublicLinks && (
        <>
          <RecipePublication recipe={recipe} locale={locale} />
          <RecipePublicSharing recipe={recipe} locale={locale} />
        </>
      )}
      {recipe.canManageAccess &&
        recipe.visibility === "PRIVATE" &&
        !recipe.deletedAt && (
          <RecipeSharing recipe={recipe} locale={locale} onRecipe={onRecipe} />
        )}
      {recipe.canEdit && !recipe.deletedAt && (
        <div className="recipe-delete">
          <button
            className="text-button danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm(t.deleteConfirm))
                void action(
                  () =>
                    mutate(`?revision=${recipe.revision}`, undefined, "DELETE"),
                  true,
                );
            }}
          >
            <Trash2 size={15} />
            {t.delete}
          </button>
        </div>
      )}
    </article>
  );
}
