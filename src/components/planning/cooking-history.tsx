"use client";
import { Clock, Trash2 } from "lucide-react";
import type { CookingEvent } from "../../../shared/planning";
import type { Locale } from "../translations";
import { api } from "../api";
import { planningMessages } from "./messages";
import { usePlanningResource } from "./use-planning";
export function CookingHistory({
  householdId,
  locale,
  onRecipe,
}: {
  householdId: string;
  locale: Locale;
  onRecipe: (id: string) => void;
}) {
  const t = planningMessages[locale];
  const resource = usePlanningResource<{ events: CookingEvent[] }>(
    `/cooking-history?householdId=${encodeURIComponent(householdId)}`,
    { events: [] },
  );
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <>
      <div className="page-heading">
        <h1>{t.history}</h1>
        <p className="muted">{t.historyHint}</p>
      </div>
      {resource.error && (
        <div className="error-box" role="alert">
          {resource.error}
        </div>
      )}
      {resource.loading && <p>{t.loading}</p>}
      {!resource.loading && !resource.data.events.length && (
        <section className="empty-state">
          <Clock size={32} />
          <p>{t.noHistory}</p>
        </section>
      )}
      <div className="history-list">
        {resource.data.events.map((event) => (
          <article className="panel history-entry" key={event.id}>
            <button
              className="history-recipe"
              onClick={() => onRecipe(event.recipe.id)}
            >
              {event.recipe.imageUrl && (
                <img src={event.recipe.imageUrl} alt="" />
              )}
              <strong>{event.recipe.title}</strong>
            </button>
            <p className="muted">
              {date.format(new Date(event.cookedAt))} · {event.servings}{" "}
              {t.servings}
            </p>
            {event.note && <p className="history-note">{event.note}</p>}
            <button
              className="icon-button danger"
              aria-label={`${t.removeHistory} ${event.recipe.title}`}
              disabled={resource.busy}
              onClick={() => {
                if (window.confirm(t.deleteConfirm))
                  void resource.run(() =>
                    api(`/cooking-history/${event.id}`, undefined, "DELETE"),
                  );
              }}
            >
              <Trash2 size={17} />
            </button>
          </article>
        ))}
      </div>
    </>
  );
}
