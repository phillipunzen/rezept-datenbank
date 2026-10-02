"use client";
import { CookidooManager } from "./cookidoo-manager";
import { useEffect, useState } from "react";
import { Check, ClipboardList, Pencil, Plus, Trash2 } from "lucide-react";
import type { ShoppingList, ShoppingItem } from "../../../shared/planning";
import { displayQuantity } from "../../../shared/planning";
import { api } from "../api";
import type { Locale } from "../translations";
import { planningMessages } from "./messages";
import { usePlanningResource, useRecipeChoices } from "./use-planning";
export function ShoppingManager({
  householdId,
  locale,
  canEdit,
}: {
  householdId: string;
  locale: Locale;
  canEdit: boolean;
}) {
  const t = planningMessages[locale];
  const resource = usePlanningResource<{ lists: ShoppingList[] }>(
    `/shopping-lists?householdId=${encodeURIComponent(householdId)}`,
    { lists: [] },
  );
  const { recipes, error } = useRecipeChoices(householdId);
  const [selected, setSelected] = useState("");
  const [pendingChecks, setPendingChecks] = useState<Record<string, boolean>>(
    {},
  );
  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  const list =
    resource.data.lists.find((row) => row.id === selected) ??
    resource.data.lists[0];
  useEffect(() => setPendingChecks({}), [list?.id, list?.revision]);
  async function add(event: React.FormEvent<HTMLFormElement>, edit: boolean) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!list) return;
    const body = {
      name: data.get("name"),
      amount: String(data.get("amount") ?? "").replace(",", ".") || null,
      unit: data.get("unit"),
      note: data.get("note"),
      revision: list.revision,
      ...(edit ? { checked: editing?.checked ?? false } : {}),
    };
    if (
      await resource.run(() =>
        api(
          `/shopping-lists/${list.id}/items${edit ? `/${editing!.id}` : ""}`,
          body,
          edit ? "PATCH" : "POST",
        ),
      )
    ) {
      form.reset();
      setEditing(null);
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>{t.shopping}</h1>
        <p className="muted">
          {!canEdit
            ? t.readonly
            : locale === "de"
              ? "Gemeinsam einkaufen. Änderungen erscheinen auch auf den anderen Geräten."
              : "Shop together. Changes also appear on other devices."}
        </p>
      </div>
      {(resource.error || error) && (
        <div className="error-box" role="alert">
          {resource.error || error}
          <button className="text-button" onClick={resource.refresh}>
            {t.refresh}
          </button>
        </div>
      )}
      <div className="collection-layout">
        <aside className="panel collection-sidebar">
          <div className="collection-tabs">
            {resource.data.lists.map((row) => (
              <button
                className={`collection-tab ${list?.id === row.id ? "active" : ""}`}
                key={row.id}
                onClick={() => {
                  setSelected(row.id);
                  setEditing(null);
                }}
              >
                <ClipboardList size={17} />
                <span>{row.name}</span>
                <small>
                  {row.items.filter((item) => !item.checked).length}
                </small>
              </button>
            ))}
          </div>
          {!resource.data.lists.length && (
            <p className="muted">{resource.loading ? t.loading : t.noLists}</p>
          )}
          {canEdit && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const name = new FormData(form).get("name");
                void resource
                  .run(async () => {
                    const result = await api<{ list: { id: string } }>(
                      "/shopping-lists",
                      { householdId, name },
                    );
                    setSelected(result.list.id);
                  })
                  .then((success) => {
                    if (success) form.reset();
                  });
              }}
            >
              <h2>{t.newList}</h2>
              <label>
                {t.name}
                <input name="name" required maxLength={120} />
              </label>
              <button className="button primary" disabled={resource.busy}>
                {t.create}
              </button>
            </form>
          )}
        </aside>
        {list && (
          <section className="collection-content">
            <div className="section-heading">
              <h2>{list.name}</h2>
              {canEdit && (
                <div className="detail-actions">
                  <button
                    className="icon-button"
                    aria-label={t.edit}
                    disabled={resource.busy}
                    onClick={() => {
                      const name = window.prompt(t.name, list.name);
                      if (name?.trim())
                        void resource.run(() =>
                          api(
                            `/shopping-lists/${list.id}`,
                            { name, revision: list.revision },
                            "PATCH",
                          ),
                        );
                    }}
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
                            `/shopping-lists/${list.id}?revision=${list.revision}`,
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
            {canEdit && (
              <form
                className="panel shopping-item-form"
                key={`${list.id}-${editing?.id ?? "new"}`}
                onSubmit={(event) => void add(event, Boolean(editing))}
              >
                <div className="planning-form-grid">
                  <label>
                    {t.item}
                    <input
                      name="name"
                      required
                      maxLength={150}
                      defaultValue={editing?.name}
                    />
                  </label>
                  <label>
                    {t.amount}
                    <input
                      name="amount"
                      inputMode="decimal"
                      pattern="[0-9]+([.,][0-9]{1,4})?"
                      defaultValue={editing?.amount ?? ""}
                    />
                  </label>
                  <label>
                    {t.unit}
                    <input
                      name="unit"
                      maxLength={24}
                      defaultValue={editing?.unit}
                    />
                  </label>
                  <label>
                    {t.note}
                    <input
                      name="note"
                      maxLength={2000}
                      defaultValue={editing?.note}
                    />
                  </label>
                </div>
                <div className="detail-actions">
                  <button className="button primary" disabled={resource.busy}>
                    <Plus size={16} />
                    {editing ? t.save : t.addItem}
                  </button>
                  {editing && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => setEditing(null)}
                    >
                      {t.cancel}
                    </button>
                  )}
                </div>
              </form>
            )}
            {canEdit && (
              <CookidooManager
                key={list.id}
                householdId={householdId}
                listId={list.id}
                locale={locale}
              />
            )}
            <div className="panel shopping-items">
              {!list.items.length && <p className="muted">{t.emptyList}</p>}
              {list.items.map((item) => (
                <div
                  className={`shopping-row ${item.checked ? "is-checked" : ""}`}
                  key={item.id}
                >
                  <label className="ingredient-checkbox">
                    <input
                      type="checkbox"
                      checked={pendingChecks[item.id] ?? item.checked}
                      aria-label={`${item.name} ${t.checked}`}
                      disabled={!canEdit || resource.busy}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setPendingChecks((current) => ({
                          ...current,
                          [item.id]: checked,
                        }));
                        void resource
                          .run(() =>
                            api(
                              `/shopping-lists/${list.id}/items/${item.id}`,
                              { checked, revision: list.revision },
                              "PATCH",
                            ),
                          )
                          .then((success) => {
                            if (!success)
                              setPendingChecks((current) => {
                                const next = { ...current };
                                delete next[item.id];
                                return next;
                              });
                          });
                      }}
                    />
                    <span>
                      <strong>{item.name}</strong>
                      {item.note && <small>{item.note}</small>}
                    </span>
                  </label>
                  <span className="shopping-quantity">
                    {displayQuantity(item.amount, item.unit, locale)}
                  </span>
                  {canEdit && (
                    <>
                      <button
                        className="icon-button"
                        aria-label={`${t.edit} ${item.name}`}
                        onClick={() => setEditing(item)}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="icon-button danger"
                        aria-label={`${t.delete} ${item.name}`}
                        disabled={resource.busy}
                        onClick={() =>
                          void resource.run(() =>
                            api(
                              `/shopping-lists/${list.id}/items/${item.id}?revision=${list.revision}`,
                              undefined,
                              "DELETE",
                            ),
                          )
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
            {canEdit && (
              <section className="panel">
                <h2>{t.fromRecipe}</h2>
                <form
                  className="inline-resource-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    const recipeId = String(data.get("recipeId"));
                    const recipe = recipes.find((row) => row.id === recipeId);
                    const sharePrivate = recipe?.visibility === "PRIVATE";
                    if (sharePrivate && !window.confirm(t.privateConfirm))
                      return;
                    void resource.run(() =>
                      api(`/shopping-lists/${list.id}/from-recipe`, {
                        recipeId,
                        servings: Number(data.get("servings")),
                        revision: list.revision,
                        sharePrivate,
                      }),
                    );
                  }}
                >
                  <label>
                    {t.recipe}
                    <select name="recipeId" required>
                      <option value="">—</option>
                      {recipes.map((recipe) => (
                        <option key={recipe.id} value={recipe.id}>
                          {recipe.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t.servings}
                    <input
                      name="servings"
                      type="number"
                      min={1}
                      max={1000}
                      defaultValue={4}
                      required
                    />
                  </label>
                  <button className="button secondary" disabled={resource.busy}>
                    {t.addToList}
                  </button>
                </form>
              </section>
            )}
          </section>
        )}
      </div>
    </>
  );
}
