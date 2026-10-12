"use client";
import {
  ArrowRight,
  CalendarDays,
  ClipboardList,
  Heart,
  Shuffle,
  UtensilsCrossed,
} from "lucide-react";
import { useState } from "react";
import { api } from "./api";
import type { RecipePage } from "../../shared/recipes";
import type { PlanEntry, CookingEvent } from "../../shared/planning";
import type { User } from "./api";
import { messages, type Locale } from "./translations";
import { planningMessages } from "./planning/messages";
import { localDate } from "./planning/meal-planner";
import { usePlanningResource } from "./planning/use-planning";
export function Dashboard({
  user,
  locale,
  showRecipes,
  householdId,
  onRecipe,
  showPlanner,
  showShopping,
}: {
  user: User;
  locale: Locale;
  showRecipes: () => void;
  householdId: string;
  onRecipe: (id: string) => void;
  showPlanner: () => void;
  showShopping: () => void;
}) {
  const t = messages[locale],
    p = planningMessages[locale];
  const household = `householdId=${encodeURIComponent(householdId)}`;
  const today = localDate();
  const plan = usePlanningResource<{ entries: PlanEntry[] }>(
    `/meal-plan?${household}&from=${today}&to=${today}`,
    { entries: [] },
  );
  const history = usePlanningResource<{ events: CookingEvent[] }>(
    `/cooking-history?${household}`,
    { events: [] },
  );
  const favorites = usePlanningResource<RecipePage>(
    `/recipes?${household}&favorites=true&pageSize=6`,
    { recipes: [], total: 0, page: 1, pageSize: 6 },
  );
  const [randomError, setRandomError] = useState("");
  const [randomBusy, setRandomBusy] = useState(false);
  async function random() {
    setRandomBusy(true);
    setRandomError("");
    try {
      const first = await api<RecipePage>(`/recipes?${household}&pageSize=1`);
      if (!first.total) return;
      const page = 1 + Math.floor(Math.random() * first.total);
      const result = await api<RecipePage>(
        `/recipes?${household}&pageSize=1&page=${page}`,
      );
      if (result.recipes[0]) onRecipe(result.recipes[0].id);
    } catch (error) {
      setRandomError(error instanceof Error ? error.message : p.error);
    } finally {
      setRandomBusy(false);
    }
  }
  const error = plan.error || history.error || favorites.error || randomError;
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">{t.home}</span>
        <h1>
          {t.greeting}, {user.name.split(" ")[0]}
          <span className="greeting-dot">.</span>
        </h1>
        <p>
          {locale === "de"
            ? "Deine Küche, auf einen Blick."
            : "Your kitchen, at a glance."}
        </p>
      </div>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      <section className="welcome-card">
        <div className="welcome-copy">
          <span className="light-badge">{today}</span>
          <h2>
            {locale === "de"
              ? "Was kochen wir heute?"
              : "What are we cooking today?"}
          </h2>
          <p>
            {locale === "de"
              ? "Rezepte entdecken, Mahlzeiten planen und zusammen einkaufen."
              : "Discover recipes, plan meals and shop together."}
          </p>
          <button className="button ivory" onClick={showRecipes}>
            {locale === "de" ? "Rezepte entdecken" : "Explore recipes"}
            <ArrowRight size={17} />
          </button>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <div className="plate">
            <span className="plate-leaf leaf-a" />
            <span className="plate-leaf leaf-b" />
            <span className="plate-leaf leaf-c" />
            <span className="plate-tomato tomato-a" />
            <span className="plate-tomato tomato-b" />
            <span className="plate-grain" />
          </div>
        </div>
      </section>
      <div className="menu-grid dashboard-actions">
        <button className="panel" onClick={showRecipes}>
          <UtensilsCrossed />
          {locale === "de" ? "Rezepte" : "Recipes"}
        </button>
        <button className="panel" onClick={showPlanner}>
          <CalendarDays />
          {p.planner}
        </button>
        <button className="panel" onClick={showShopping}>
          <ClipboardList />
          {p.shopping}
        </button>
        <button
          className="panel"
          onClick={() => void random()}
          disabled={randomBusy}
        >
          <Shuffle />
          {locale === "de" ? "Zufälliges Rezept" : "Random recipe"}
        </button>
      </div>
      <section className="panel">
        <h2>{locale === "de" ? "Heute geplant" : "Planned today"}</h2>
        {plan.loading ? (
          <p>{p.loading}</p>
        ) : !plan.data.entries.length ? (
          <p className="muted">{p.noMeals}</p>
        ) : (
          <div className="reference-grid">
            {plan.data.entries.map((entry) => (
              <button
                key={entry.id}
                className="reference-open"
                onClick={() => onRecipe(entry.recipe.id)}
              >
                {entry.recipe.imageUrl && (
                  <img src={entry.recipe.imageUrl} alt="" />
                )}
                <strong>{entry.recipe.title}</strong>
                <small>
                  {
                    p[
                      entry.slot.toLowerCase() as
                        "breakfast" | "lunch" | "dinner" | "snack"
                    ]
                  }{" "}
                  · {entry.servings} {p.servings}
                </small>
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <h2>{locale === "de" ? "Zuletzt gekocht" : "Recently cooked"}</h2>
        {history.loading ? (
          <p>{p.loading}</p>
        ) : !history.data.events.length ? (
          <p className="muted">{p.noHistory}</p>
        ) : (
          <div className="reference-grid">
            {history.data.events.slice(0, 6).map((event) => (
              <button
                key={event.id}
                className="reference-open"
                onClick={() => onRecipe(event.recipe.id)}
              >
                <strong>{event.recipe.title}</strong>
                <small>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                  }).format(new Date(event.cookedAt))}
                </small>
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <h2>
          <Heart size={18} /> {locale === "de" ? "Favoriten" : "Favorites"}
        </h2>
        {favorites.loading ? (
          <p>{p.loading}</p>
        ) : !favorites.data.recipes.length ? (
          <p className="muted">
            {locale === "de"
              ? "Markiere deine Lieblingsrezepte mit einem Herz."
              : "Mark your favorite recipes with a heart."}
          </p>
        ) : (
          <div className="reference-grid">
            {favorites.data.recipes.map((recipe) => (
              <button
                key={recipe.id}
                className="reference-open"
                onClick={() => onRecipe(recipe.id)}
              >
                {recipe.images[0] && <img src={recipe.images[0].url} alt="" />}
                <strong>{recipe.title}</strong>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
