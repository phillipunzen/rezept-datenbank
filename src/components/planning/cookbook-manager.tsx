"use client";
import { useState } from "react";
import { BookOpen, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Cookbook } from "../../../shared/planning";
import type { Locale } from "../translations";
import { api } from "../api";
import { planningMessages } from "./messages";
import { usePlanningResource, useRecipeChoices } from "./use-planning";
export function CookbookManager({
  householdId,
  locale,
  canEdit,
  onRecipe,
}: {
  householdId: string;
  locale: Locale;
  canEdit: boolean;
  onRecipe: (id: string) => void;
}) {
  const t = planningMessages[locale];
  const resource = usePlanningResource<{ cookbooks: Cookbook[] }>(
    `/cookbooks?householdId=${encodeURIComponent(householdId)}`,
    { cookbooks: [] },
  );
  const choices = useRecipeChoices(householdId);
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState(false);
  const book =
    resource.data.cookbooks.find((book) => book.id === selected) ??
    resource.data.cookbooks[0];
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (
      await resource.run(async () => {
        const result = await api<{ cookbook: { id: string } }>("/cookbooks", {
          householdId,
          name: data.name,
          description: data.description,
        });
        setSelected(result.cookbook.id);
      })
    )
      form.reset();
  }
  return (
    <>
      <div className="page-heading">
        <h1>{t.books}</h1>
        <p className="muted">{t.booksHint}</p>
      </div>
      {(resource.error || choices.error) && (
        <div className="error-box" role="alert">
          {resource.error || choices.error}
          <button className="text-button" onClick={resource.refresh}>
            {t.refresh}
          </button>
        </div>
      )}
      {!canEdit && <p className="muted">{t.readonly}</p>}
      <div className="collection-layout">
        <aside className="panel collection-sidebar">
          <div className="collection-tabs">
            {resource.data.cookbooks.map((row) => (
              <button
                key={row.id}
                className={`collection-tab ${row.id === book?.id ? "active" : ""}`}
                onClick={() => {
                  setSelected(row.id);
                  setEditing(false);
                }}
              >
                <BookOpen size={18} />
                <span>{row.name}</span>
                <small>{row.recipes.length}</small>
              </button>
            ))}
          </div>
          {resource.loading && <p>{t.loading}</p>}
          {!resource.loading && !resource.data.cookbooks.length && (
            <p className="muted">{t.noBooks}</p>
          )}
          {canEdit && (
            <form onSubmit={create}>
              <h2>{t.newBook}</h2>
              <label>
                {t.name}
                <input name="name" maxLength={120} required />
              </label>
              <label>
                {t.description}
                <textarea name="description" maxLength={2000} />
              </label>
              <button className="button primary" disabled={resource.busy}>
                <Plus size={16} />
                {t.create}
              </button>
            </form>
          )}
        </aside>
        {book && (
          <section className="collection-content">
            <div className="section-heading">
              <div>
                <h2>{book.name}</h2>
                <p className="muted">{book.description}</p>
              </div>
              {canEdit && (
                <div className="detail-actions">
                  <button
                    className="icon-button"
                    aria-label={t.edit}
                    onClick={() => setEditing(!editing)}
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    className="icon-button danger"
                    aria-label={t.delete}
                    disabled={resource.busy}
                    onClick={() => {
                      if (window.confirm(t.deleteConfirm))
                        void resource.run(() =>
                          api(
                            `/cookbooks/${book.id}?revision=${book.revision}`,
                            undefined,
                            "DELETE",
                          ),
                        );
                    }}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              )}
            </div>
            {editing && (
              <form
                key={book.id}
                className="panel"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = Object.fromEntries(
                    new FormData(event.currentTarget),
                  );
                  void resource
                    .run(() =>
                      api(
                        `/cookbooks/${book.id}`,
                        { ...data, revision: book.revision },
                        "PATCH",
                      ),
                    )
                    .then((success) => {
                      if (success) setEditing(false);
                    });
                }}
              >
                <label>
                  {t.name}
                  <input
                    name="name"
                    defaultValue={book.name}
                    maxLength={120}
                    required
                  />
                </label>
                <label>
                  {t.description}
                  <textarea
                    name="description"
                    defaultValue={book.description}
                    maxLength={2000}
                  />
                </label>
                <button className="button primary" disabled={resource.busy}>
                  {t.save}
                </button>
              </form>
            )}
            {canEdit && (
              <form
                className="inline-resource-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void resource.run(() =>
                    api(`/cookbooks/${book.id}/recipes`, {
                      recipeId: data.get("recipeId"),
                      revision: book.revision,
                      remove: false,
                    }),
                  );
                }}
              >
                <label>
                  {t.recipe}
                  <select name="recipeId" required>
                    <option value="">—</option>
                    {choices.recipes
                      .filter(
                        (recipe) =>
                          !book.recipes.some((entry) => entry.id === recipe.id),
                      )
                      .map((recipe) => (
                        <option key={recipe.id} value={recipe.id}>
                          {recipe.title}
                        </option>
                      ))}
                  </select>
                </label>
                <button className="button secondary" disabled={resource.busy}>
                  {t.addRecipe}
                </button>
              </form>
            )}
            {!book.recipes.length && (
              <section className="empty-state">
                <BookOpen size={32} />
                <p>{t.noRecipes}</p>
              </section>
            )}
            <div className="reference-grid">
              {book.recipes.map((recipe) => (
                <div className="reference-card" key={recipe.id}>
                  <button
                    className="reference-open"
                    onClick={() => onRecipe(recipe.id)}
                  >
                    {recipe.imageUrl && <img src={recipe.imageUrl} alt="" />}
                    <strong>{recipe.title}</strong>
                    {recipe.visibility === "PRIVATE" && (
                      <small>{t.privateRecipe}</small>
                    )}
                  </button>
                  {canEdit && (
                    <button
                      className="icon-button"
                      aria-label={`${t.removeRecipe} ${recipe.title}`}
                      disabled={resource.busy}
                      onClick={() =>
                        void resource.run(() =>
                          api(`/cookbooks/${book.id}/recipes`, {
                            recipeId: recipe.id,
                            revision: book.revision,
                            remove: true,
                          }),
                        )
                      }
                    >
                      <X size={17} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
