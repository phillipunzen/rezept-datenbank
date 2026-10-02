"use client";
import { useEffect, useState } from "react";
import { api } from "../api";
import type {
  RecipeDetail,
  RecipeInput,
  RecipePage,
  RecipeSummary,
} from "../../../shared/recipes";
import type { Locale } from "../translations";
import { recipeMessages } from "./messages";
import { RecipeList, defaultFilters, type Filters } from "./recipe-list";
import { RecipeEditor } from "./recipe-editor";
import { RecipeView } from "./recipe-detail";
import { uploadImage, type Metadata } from "./api";
import { RecipeUrlImport } from "./recipe-url-import";
import type { RecipeImportPreview } from "../../../shared/recipe-import";
export function RecipeWorkspace({
  householdId,
  locale,
  canEdit,
  onDirty,
  initialRecipeId,
}: {
  householdId: string;
  locale: Locale;
  canEdit: boolean;
  onDirty: (dirty: boolean) => void;
  initialRecipeId?: string;
}) {
  const [screen, setScreen] = useState<"list" | "detail" | "editor">("list");
  const [selected, setSelected] = useState<RecipeDetail | null>(null);
  const [page, setPage] = useState<RecipePage | null>(null);
  const [metadata, setMetadata] = useState<Metadata>({
    tags: [],
    categories: [],
    ingredients: [],
    units: [],
  });
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [importPreview, setImportPreview] =
    useState<RecipeImportPreview | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [notice, setNotice] = useState("");
  const showLibrary = screen === "list";
  const t = recipeMessages[locale];
  useEffect(() => {
    if (!initialRecipeId) return;
    let active = true;
    setBusy(true);
    api<{ recipe: RecipeDetail }>(`/recipes/${initialRecipeId}`)
      .then((result) => {
        if (active) {
          setSelected(result.recipe);
          setScreen("detail");
        }
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : t.failed);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [initialRecipeId, t.failed]);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    if (dirty) window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    let active = true;
    api<Metadata>(
      `/recipe-metadata?householdId=${encodeURIComponent(householdId)}`,
    )
      .then((result) => {
        if (active) setMetadata(result);
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : t.failed);
      });
    return () => {
      active = false;
    };
  }, [householdId, refresh, t.failed]);
  useEffect(() => {
    if (!showLibrary) return;
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      const query = new URLSearchParams({
        householdId,
        page: String(filters.page),
      });
      if (filters.q) query.set("q", filters.q);
      if (filters.category) query.set("category", filters.category);
      if (filters.tag) query.set("tag", filters.tag);
      if (filters.favorites) query.set("favorites", "true");
      if (filters.trash) query.set("trash", "true");
      if (filters.diet) query.set(filters.diet, "true");
      if (filters.maxMinutes) query.set("maxMinutes", filters.maxMinutes);
      if (filters.minRating) query.set("minRating", filters.minRating);
      if (filters.availableIngredients) {
        query.set("availableIngredients", filters.availableIngredients);
        query.set("maxMissing", filters.maxMissing || "0");
      }
      if (filters.thermomix) query.set("thermomix", "true");
      api<RecipePage>(`/recipes?${query}`)
        .then((result) => {
          if (active) setPage(result);
        })
        .catch((error) => {
          if (active)
            setError(error instanceof Error ? error.message : t.failed);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [householdId, filters, refresh, showLibrary, t.failed]);
  function back() {
    if (busy || importBusy) return;
    if (dirty && !window.confirm(t.discard)) return;
    setDirty(false);
    setError("");
    setNotice("");
    setImportPreview(null);
    setScreen("list");
    setRefresh((value) => value + 1);
    window.scrollTo({ top: 0 });
  }
  async function select(recipe: RecipeSummary) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ recipe: RecipeDetail }>(
        `/recipes/${recipe.id}${recipe.deletedAt ? "?includeDeleted=true" : ""}`,
      );
      setSelected(result.recipe);
      setScreen("detail");
      window.scrollTo({ top: 0 });
    } catch (error) {
      setError(error instanceof Error ? error.message : t.failed);
    } finally {
      setBusy(false);
    }
  }
  async function save(data: RecipeInput) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ recipe: RecipeDetail }>(
        selected ? `/recipes/${selected.id}` : "/recipes",
        selected ? { ...data, revision: selected.revision } : data,
        selected ? "PATCH" : "POST",
      );
      let recipe = result.recipe;
      if (!selected && importPreview?.imageDataUrl) {
        try {
          recipe = await persistImportedImage(
            recipe,
            importPreview.imageDataUrl,
          );
          setImportPreview(null);
        } catch {
          setNotice(t.imageImportFailed);
        }
      } else setImportPreview(null);
      setSelected(recipe);
      setDirty(false);
      setScreen("detail");
      setRefresh((value) => value + 1);
      window.scrollTo({ top: 0 });
    } catch (error) {
      setError(error instanceof Error ? error.message : t.failed);
    } finally {
      setBusy(false);
    }
  }
  async function persistImportedImage(recipe: RecipeDetail, dataUrl: string) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return uploadImage(
      recipe,
      new File([blob], "imported-recipe.webp", { type: "image/webp" }),
    );
  }
  async function retryImportedImage() {
    if (!selected || !importPreview?.imageDataUrl || busy) return;
    setBusy(true);
    try {
      setSelected(
        await persistImportedImage(selected, importPreview.imageDataUrl),
      );
      setImportPreview(null);
      setNotice("");
    } catch {
      setNotice(t.imageImportFailed);
    } finally {
      setBusy(false);
    }
  }
  if (screen === "editor")
    return (
      <>
        {!selected && (
          <RecipeUrlImport
            householdId={householdId}
            locale={locale}
            busy={busy}
            onLoading={setImportBusy}
            onReplace={() => !dirty || window.confirm(t.discard)}
            onImport={(preview) => {
              setImportPreview(preview);
              setDirty(true);
              setError("");
              setEditorGeneration((value) => value + 1);
            }}
          />
        )}
        {!selected && importPreview && (
          <section
            className="panel recipe-import-preview"
            aria-label={t.importReview}
          >
            <p>
              <strong>{t.importReview}</strong>
            </p>
            {importPreview.warnings.length > 0 && (
              <ul>
                {importPreview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            {importPreview.imageDataUrl && (
              <div className="imported-image">
                <img src={importPreview.imageDataUrl} alt={t.importedImage} />
                <div>
                  <p className="small muted">{t.importedImageHint}</p>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy || importBusy}
                    onClick={() => {
                      setImportPreview({
                        ...importPreview,
                        imageDataUrl: null,
                      });
                      setDirty(true);
                    }}
                  >
                    {t.deleteImage}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
        <RecipeEditor
          key={editorGeneration}
          householdId={householdId}
          recipe={selected}
          initialDraft={importPreview?.draft}
          locale={locale}
          metadata={metadata}
          busy={busy || importBusy}
          error={error}
          onSave={save}
          onCancel={back}
          onDirty={() => setDirty(true)}
        />
      </>
    );
  return (
    <div
      className={`recipe-workspace ${screen === "detail" && selected ? "has-detail" : ""}`}
    >
      {error && (
        <div className="error-box workspace-error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => setRefresh((value) => value + 1)}
          >
            {t.retry}
          </button>
        </div>
      )}
      {showLibrary && (
        <section className="recipe-library">
          <RecipeList
            locale={locale}
            page={page}
            metadata={metadata}
            filters={filters}
            loading={loading}
            disabled={busy}
            canEdit={canEdit}
            onFilters={setFilters}
            onSelect={(recipe) => {
              void select(recipe);
            }}
            onNew={() => {
              setSelected(null);
              setError("");
              setDirty(false);
              setImportPreview(null);
              setNotice("");
              setScreen("editor");
              window.scrollTo({ top: 0 });
            }}
          />
        </section>
      )}
      {screen === "detail" && selected && (
        <section className="recipe-detail-view" aria-label={t.recipeDetails}>
          {notice && (
            <div className="error-box" role="alert">
              {notice}
              {importPreview?.imageDataUrl && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void retryImportedImage()}
                >
                  {t.retryImportedImage}
                </button>
              )}
            </div>
          )}
          <RecipeView
            onDuplicate={(recipe) => {
              setSelected(recipe);
              setRefresh((value) => value + 1);
              window.scrollTo({ top: 0 });
            }}
            canManageLists={canEdit}
            key={selected.id}
            recipe={selected}
            locale={locale}
            onRecipe={(recipe) => {
              setSelected((previous) =>
                previous?.id === recipe.id ? recipe : previous,
              );
              setRefresh((value) => value + 1);
            }}
            onBack={back}
            onEdit={() => {
              setError("");
              setScreen("editor");
              window.scrollTo({ top: 0 });
            }}
            onBusy={setBusy}
            onDeleted={() => {
              setScreen("list");
              setSelected(null);
              setRefresh((value) => value + 1);
            }}
          />
        </section>
      )}
    </div>
  );
}
