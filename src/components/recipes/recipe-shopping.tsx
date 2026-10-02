"use client";
import { useState } from "react";
import { ClipboardList } from "lucide-react";
import type { RecipeDetail } from "../../../shared/recipes";
import type { ShoppingList } from "../../../shared/planning";
import type { Locale } from "../translations";
import { api } from "../api";
import { planningMessages } from "../planning/messages";
import { usePlanningResource } from "../planning/use-planning";
export function RecipeShopping({
  recipe,
  portions,
  locale,
}: {
  recipe: RecipeDetail;
  portions: number;
  locale: Locale;
}) {
  const t = planningMessages[locale];
  const resource = usePlanningResource<{ lists: ShoppingList[] }>(
    `/shopping-lists?householdId=${encodeURIComponent(recipe.householdId)}`,
    { lists: [] },
  );
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <section className="recipe-shopping no-print">
      <button
        className="button secondary"
        onClick={() => {
          setOpen(!open);
          setSaved(false);
        }}
      >
        <ClipboardList size={17} />
        {t.addToList}
      </button>
      {open && (
        <form
          className="panel inline-resource-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const list = resource.data.lists.find(
              (row) => row.id === data.get("listId"),
            );
            const sharePrivate = recipe.visibility === "PRIVATE";
            if (sharePrivate && !window.confirm(t.privateConfirm)) return;
            const success = await resource.run(async () => {
              const target =
                list ??
                (
                  await api<{ list: { id: string; revision: number } }>(
                    "/shopping-lists",
                    {
                      householdId: recipe.householdId,
                      name: String(data.get("name")),
                    },
                  )
                ).list;
              await api(`/shopping-lists/${target.id}/from-recipe`, {
                recipeId: recipe.id,
                servings: Number(data.get("servings")),
                revision: target.revision,
                sharePrivate,
              });
            });
            if (success) setSaved(true);
          }}
        >
          <label>
            {t.targetList}
            <select name="listId">
              <option value="">{t.newList}</option>
              {resource.data.lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.name}
            <input
              name="name"
              maxLength={120}
              defaultValue={locale === "de" ? "Einkauf" : "Shopping"}
            />
          </label>
          <label>
            {t.servings}
            <input
              name="servings"
              type="number"
              min={1}
              max={1000}
              defaultValue={portions}
              required
            />
          </label>
          <button
            className="button primary"
            disabled={resource.busy || resource.loading}
          >
            {t.addToList}
          </button>
          {resource.error && (
            <p role="alert" className="error-box">
              {resource.error}
            </p>
          )}
          {saved && <p role="status">{t.updated}</p>}
        </form>
      )}
    </section>
  );
}
