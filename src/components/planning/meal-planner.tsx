"use client";
import { useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
} from "lucide-react";
import type {
  MealSlot,
  PlanEntry,
  ShoppingList,
} from "../../../shared/planning";
import type { Locale } from "../translations";
import { api } from "../api";
import { planningMessages } from "./messages";
import { usePlanningResource, useRecipeChoices } from "./use-planning";
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}
export function monday(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return shiftDate(value, -(date.getDay() + 6) % 7);
}
const slots: MealSlot[] = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"];
export function MealPlanner({
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
  const [anchor, setAnchor] = useState(localDate());
  const [dayOnly, setDayOnly] = useState(false);
  const [editing, setEditing] = useState<PlanEntry | null>(null);
  const from = dayOnly ? anchor : monday(anchor),
    to = dayOnly ? anchor : shiftDate(from, 6);
  const resource = usePlanningResource<{ entries: PlanEntry[] }>(
    `/meal-plan?householdId=${encodeURIComponent(householdId)}&from=${from}&to=${to}`,
    { entries: [] },
  );
  const lists = usePlanningResource<{ lists: ShoppingList[] }>(
    `/shopping-lists?householdId=${encodeURIComponent(householdId)}`,
    { lists: [] },
  );
  const { recipes, error } = useRecipeChoices(householdId);
  const names = {
    BREAKFAST: t.breakfast,
    LUNCH: t.lunch,
    DINNER: t.dinner,
    SNACK: t.snack,
  };
  const dateFormat = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = {
      date: data.get("date"),
      slot: data.get("slot"),
      servings: Number(data.get("servings")),
      ...(editing
        ? { revision: editing.revision }
        : { householdId, recipeId: data.get("recipeId") }),
    };
    if (
      await resource.run(() =>
        api(
          `/meal-plan${editing ? `/${editing.id}` : ""}`,
          body,
          editing ? "PATCH" : "POST",
        ),
      )
    ) {
      setEditing(null);
      form.reset();
    }
  }
  function move(entry: PlanEntry, date: string, slot: MealSlot) {
    void resource.run(() =>
      api(
        `/meal-plan/${entry.id}`,
        { date, slot, servings: entry.servings, revision: entry.revision },
        "PATCH",
      ),
    );
  }
  return (
    <>
      <div className="page-heading">
        <h1>{t.planner}</h1>
        <p className="muted">
          {!canEdit
            ? t.readonly
            : locale === "de"
              ? "Plane eure Mahlzeiten. Ziehe einen Eintrag zum Verschieben auf einen anderen Tag."
              : "Plan your meals. Drag an entry onto another day to move it."}
        </p>
      </div>
      {(resource.error || lists.error || error) && (
        <div className="error-box" role="alert">
          {resource.error || lists.error || error}
          <button className="text-button" onClick={resource.refresh}>
            {t.refresh}
          </button>
        </div>
      )}
      <div className="planner-toolbar">
        <div className="detail-actions">
          <button
            className="icon-button"
            aria-label={t.previous}
            onClick={() => setAnchor(shiftDate(anchor, dayOnly ? -1 : -7))}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            className="button secondary"
            onClick={() => setAnchor(localDate())}
          >
            {t.today}
          </button>
          <button
            className="icon-button"
            aria-label={t.next}
            onClick={() => setAnchor(shiftDate(anchor, dayOnly ? 1 : 7))}
          >
            <ChevronRight size={20} />
          </button>
        </div>
        <label>
          {t.date}
          <input
            type="date"
            value={anchor}
            required
            onChange={(event) => {
              if (event.target.value) setAnchor(event.target.value);
            }}
          />
        </label>
        <div className="detail-actions">
          <button
            className={`button ${!dayOnly ? "primary" : "secondary"}`}
            onClick={() => setDayOnly(false)}
          >
            {t.week}
          </button>
          <button
            className={`button ${dayOnly ? "primary" : "secondary"}`}
            onClick={() => setDayOnly(true)}
          >
            {t.day}
          </button>
        </div>
      </div>
      {canEdit && (
        <form
          className="panel planning-entry-form"
          key={editing?.id ?? "new"}
          onSubmit={save}
        >
          <h2>{editing ? t.move : t.addMeal}</h2>
          <div className="planning-form-grid">
            {!editing && (
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
            )}
            <label>
              {t.date}
              <input
                name="date"
                type="date"
                required
                defaultValue={editing?.date ?? anchor}
              />
            </label>
            <label>
              {t.meal}
              <select name="slot" defaultValue={editing?.slot ?? "DINNER"}>
                {slots.map((slot) => (
                  <option key={slot} value={slot}>
                    {names[slot]}
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
                defaultValue={editing?.servings ?? 4}
                required
              />
            </label>
          </div>
          <div className="detail-actions">
            <button className="button primary" disabled={resource.busy}>
              {editing ? t.save : t.addMeal}
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
      <div className={`meal-calendar ${dayOnly ? "one-day" : ""}`}>
        {Array.from({ length: dayOnly ? 1 : 7 }, (_, i) =>
          shiftDate(from, i),
        ).map((date) => (
          <section
            className={`meal-day ${date === localDate() ? "today" : ""}`}
            key={date}
          >
            <h2>{dateFormat.format(new Date(`${date}T12:00:00`))}</h2>
            {slots.map((slot) => (
              <div
                className="meal-slot"
                key={slot}
                data-date={date}
                data-slot={slot}
                aria-label={`${names[slot]} ${date}`}
                onDragOver={(event) => {
                  if (canEdit) event.preventDefault();
                }}
                onDrop={(event) => {
                  if (!canEdit) return;
                  event.preventDefault();
                  const entry = resource.data.entries.find(
                    (entry) =>
                      entry.id === event.dataTransfer.getData("text/plain"),
                  );
                  if (entry) move(entry, date, slot);
                }}
              >
                <h3>{names[slot]}</h3>
                {resource.data.entries
                  .filter((entry) => entry.date === date && entry.slot === slot)
                  .map((entry) => (
                    <div
                      className="meal-card"
                      key={entry.id}
                      draggable={canEdit && !resource.busy}
                      onDragStart={(event) =>
                        event.dataTransfer.setData("text/plain", entry.id)
                      }
                    >
                      <button
                        className="meal-open"
                        onClick={() => onRecipe(entry.recipe.id)}
                      >
                        {entry.recipe.imageUrl && (
                          <img src={entry.recipe.imageUrl} alt="" />
                        )}
                        <strong>{entry.recipe.title}</strong>
                      </button>
                      <small>
                        {entry.servings} {t.servings}
                      </small>
                      {canEdit && (
                        <div className="detail-actions">
                          <button
                            className="icon-button"
                            aria-label={`${t.edit} ${entry.recipe.title}`}
                            onClick={() => setEditing(entry)}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            className="icon-button danger"
                            aria-label={`${t.delete} ${entry.recipe.title}`}
                            disabled={resource.busy}
                            onClick={() =>
                              void resource.run(() =>
                                api(
                                  `/meal-plan/${entry.id}?revision=${entry.revision}`,
                                  undefined,
                                  "DELETE",
                                ),
                              )
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            ))}
          </section>
        ))}
      </div>
      {resource.loading && <p>{t.loading}</p>}
      {!resource.loading && !resource.data.entries.length && (
        <p className="muted">{t.noMeals}</p>
      )}
      {canEdit && (
        <section className="panel plan-shopping">
          <h2>{t.fromPlan}</h2>
          <form
            className="inline-resource-form"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const list = lists.data.lists.find(
                (list) => list.id === data.get("listId"),
              );
              if (!list) return;
              const sharePrivate = resource.data.entries.some(
                (entry) => entry.recipe.visibility === "PRIVATE",
              );
              if (sharePrivate && !window.confirm(t.privateConfirm)) return;
              void lists.run(() =>
                api(`/shopping-lists/${list.id}/from-plan`, {
                  from,
                  to,
                  revision: list.revision,
                  sharePrivate,
                }),
              );
            }}
          >
            <label>
              {t.targetList}
              <select name="listId" required>
                <option value="">—</option>
                {lists.data.lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button secondary"
              disabled={lists.busy || !resource.data.entries.length}
            >
              {t.addToList}
            </button>
          </form>
        </section>
      )}
    </>
  );
}
