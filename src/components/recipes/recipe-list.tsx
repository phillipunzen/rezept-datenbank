import {
  ArrowLeft,
  ArrowRight,
  Clock,
  Heart,
  Plus,
  Search,
  UtensilsCrossed,
} from "lucide-react";
import type { RecipePage, RecipeSummary } from "../../../shared/recipes";
import type { Locale } from "../translations";
import { recipeMessages } from "./messages";
import type { Metadata } from "./api";
export interface Filters {
  q: string;
  category: string;
  tag: string;
  favorites: boolean;
  trash: boolean;
  diet: string;
  maxMinutes: string;
  minRating: string;
  availableIngredients: string;
  maxMissing: string;
  thermomix: boolean;
  page: number;
}
export const defaultFilters: Filters = {
  q: "",
  category: "",
  tag: "",
  favorites: false,
  trash: false,
  diet: "",
  maxMinutes: "",
  minRating: "",
  availableIngredients: "",
  maxMissing: "3",
  thermomix: false,
  page: 1,
};
export function RecipeList({
  locale,
  page,
  metadata,
  filters,
  loading,
  canEdit,
  onFilters,
  onSelect,
  onNew,
  selectedId,
  disabled = false,
}: {
  locale: Locale;
  page: RecipePage | null;
  metadata: Metadata;
  filters: Filters;
  loading: boolean;
  canEdit: boolean;
  onFilters: (filters: Filters) => void;
  onSelect: (recipe: RecipeSummary) => void;
  onNew: () => void;
  selectedId?: string;
  disabled?: boolean;
}) {
  const t = recipeMessages[locale];
  const set = (patch: Partial<Filters>) =>
    onFilters({ ...filters, ...patch, page: patch.page ?? 1 });
  return (
    <>
      <div className="recipe-list-heading">
        <div>
          <h1>{t.title}</h1>
          <p className="muted">
            {page?.total ?? "…"} {t.found}
          </p>
        </div>
        {canEdit && (
          <button
            className="button primary"
            onClick={onNew}
            disabled={disabled}
          >
            <Plus size={18} />
            {t.newRecipe}
          </button>
        )}
      </div>
      <div className="recipe-filter-panel">
        <div className="search-input">
          <Search size={19} />
          <input
            maxLength={120}
            aria-label={t.search}
            placeholder={t.search}
            value={filters.q}
            onChange={(event) => set({ q: event.target.value })}
          />
        </div>
        <details className="advanced-recipe-filters">
          <summary>
            {locale === "de"
              ? "Weitere Filter · Was kann ich kochen?"
              : "More filters · What can I cook?"}
          </summary>
          <div className="planning-form-grid">
            <label>
              {locale === "de" ? "Mindestbewertung" : "Minimum rating"}
              <select
                aria-label={
                  locale === "de" ? "Mindestbewertung" : "Minimum rating"
                }
                value={filters.minRating}
                onChange={(event) => set({ minRating: event.target.value })}
              >
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((rating) => (
                  <option key={rating} value={rating}>
                    ≥ {rating} ★
                  </option>
                ))}
              </select>
            </label>
            <label>
              {locale === "de"
                ? "Vorhandene Zutaten (Komma getrennt)"
                : "Available ingredients (comma-separated)"}
              <input
                maxLength={2000}
                value={filters.availableIngredients}
                onChange={(event) =>
                  set({ availableIngredients: event.target.value })
                }
              />
            </label>
            <label>
              {locale === "de"
                ? "Maximal fehlende Zutaten"
                : "Maximum missing ingredients"}
              <input
                type="number"
                min={0}
                max={100}
                value={filters.maxMissing}
                onChange={(event) => set({ maxMissing: event.target.value })}
              />
            </label>
            <label className="ingredient-checkbox">
              <input
                type="checkbox"
                checked={filters.thermomix}
                onChange={(event) => set({ thermomix: event.target.checked })}
              />
              {locale === "de"
                ? "Bestätigte Thermomix-Schritte"
                : "Confirmed Thermomix steps"}
            </label>
          </div>
        </details>
        <div className="recipe-filter-row">
          <select
            aria-label={t.allCategories}
            value={filters.category}
            onChange={(event) => set({ category: event.target.value })}
          >
            <option value="">{t.allCategories}</option>
            {metadata.categories.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <select
            aria-label={t.allTags}
            value={filters.tag}
            onChange={(event) => set({ tag: event.target.value })}
          >
            <option value="">{t.allTags}</option>
            {metadata.tags.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <select
            aria-label={t.vegetarian}
            value={filters.diet}
            onChange={(event) => set({ diet: event.target.value })}
          >
            <option value="">{t.all}</option>
            <option value="vegetarian">{t.vegetarian}</option>
            <option value="vegan">{t.vegan}</option>
          </select>
          <select
            aria-label={t.anyTime}
            value={filters.maxMinutes}
            onChange={(event) => set({ maxMinutes: event.target.value })}
          >
            <option value="">{t.anyTime}</option>
            {[15, 30, 60, 120].map((time) => (
              <option key={time} value={time}>
                ≤ {time} {t.minutes}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="recipe-list-tabs" role="group" aria-label={t.title}>
        {[
          { label: t.all, trash: false, favorites: false },
          { label: t.favorites, trash: false, favorites: true },
          { label: t.trash, trash: true, favorites: false },
        ].map((tab) => (
          <button
            key={tab.label}
            aria-pressed={
              filters.trash === tab.trash && filters.favorites === tab.favorites
            }
            onClick={() => set({ trash: tab.trash, favorites: tab.favorites })}
          >
            {tab.label}
          </button>
        ))}
        <span className="muted small">
          {page?.total ?? "…"} {t.found}
        </span>
      </div>
      {filters.trash && <p className="small muted">{t.trashHint}</p>}
      {loading ? (
        <div className="recipe-loading" role="status">
          {t.loading}
        </div>
      ) : !page?.recipes.length ? (
        <div className="recipes-empty">
          <div className="empty-recipe-icon">
            <UtensilsCrossed size={40} />
          </div>
          <h2>
            {filters.q ||
            filters.favorites ||
            filters.trash ||
            filters.category ||
            filters.tag ||
            filters.diet ||
            filters.maxMinutes
              ? t.noResults
              : t.empty}
          </h2>
          <p>
            {filters.q ||
            filters.favorites ||
            filters.trash ||
            filters.category ||
            filters.tag ||
            filters.diet ||
            filters.maxMinutes
              ? t.noResultsText
              : t.emptyText}
          </p>
          {canEdit && !filters.trash && (
            <button
              className="button primary"
              onClick={onNew}
              disabled={disabled}
            >
              <Plus size={17} />
              {t.newRecipe}
            </button>
          )}
        </div>
      ) : (
        <div className="real-recipe-grid">
          {page.recipes.map((recipe) => (
            <button
              className="real-recipe-card"
              key={recipe.id}
              aria-current={selectedId === recipe.id ? "true" : undefined}
              disabled={disabled}
              onClick={() => onSelect(recipe)}
            >
              <div className="real-recipe-cover">
                {recipe.images[0] ? (
                  <img src={recipe.images[0].url} alt="" loading="lazy" />
                ) : (
                  <UtensilsCrossed size={43} strokeWidth={1.1} />
                )}
                <div className="card-badges">
                  {recipe.visibility === "PRIVATE" && (
                    <span>{t.privateVisibility}</span>
                  )}
                  {recipe.vegan ? (
                    <span>{t.vegan}</span>
                  ) : (
                    recipe.vegetarian && <span>{t.vegetarian}</span>
                  )}
                  {recipe.favorite && (
                    <span className="card-heart">
                      <Heart size={14} fill="currentColor" />
                    </span>
                  )}
                </div>
              </div>
              <div className="real-recipe-copy">
                <small>
                  {recipe.categories.slice(0, 2).join(" · ") || t.found}
                </small>
                {selectedId ? (
                  <span className="recipe-card-title">{recipe.title}</span>
                ) : (
                  <h2>{recipe.title}</h2>
                )}
                {recipe.missingIngredients && (
                  <p className="small muted">
                    {recipe.missingIngredients.length
                      ? (locale === "de" ? "Fehlt: " : "Missing: ") +
                        recipe.missingIngredients.join(", ")
                      : locale === "de"
                        ? "Alle Zutaten vorhanden"
                        : "All ingredients available"}
                  </p>
                )}
                {recipe.description && <p>{recipe.description}</p>}
                <div className="card-facts">
                  <span>
                    <Clock size={14} />
                    {recipe.prepMinutes + recipe.cookMinutes} {t.minutes}
                  </span>
                  <span>
                    {recipe.servings} {t.servings}
                  </span>
                  {recipe.averageRating !== null && (
                    <span>★ {recipe.averageRating.toFixed(1)}</span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {page && page.total > page.pageSize && (
        <div className="recipe-pagination">
          <button
            className="button secondary"
            disabled={loading || filters.page === 1}
            onClick={() => set({ page: filters.page - 1 })}
          >
            <ArrowLeft size={15} />
            {t.previous}
          </button>
          <span>
            {t.page} {filters.page} {t.of}{" "}
            {Math.ceil(page.total / page.pageSize)}
          </span>
          <button
            className="button secondary"
            disabled={
              loading || filters.page >= Math.ceil(page.total / page.pageSize)
            }
            onClick={() => set({ page: filters.page + 1 })}
          >
            {t.next}
            <ArrowRight size={15} />
          </button>
        </div>
      )}
    </>
  );
}
