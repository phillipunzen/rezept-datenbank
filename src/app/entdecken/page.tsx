import { notFound } from "next/navigation";
import type { PublicCatalogResponse } from "../../../shared/public-recipes";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Rezepte entdecken · Rezeptdatenbank",
  description:
    "Öffentliche Rezepte entdecken, Zutaten ansehen und neue Ideen für die Küche finden.",
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const input = await searchParams,
    first = (key: string) =>
      typeof input[key] === "string" ? (input[key] as string) : "";
  const q = first("q").slice(0, 200),
    diet = ["vegan", "vegetarian"].includes(first("diet"))
      ? first("diet")
      : "all";
  const rawPage = Number(first("page") || 1),
    page =
      Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 100000
        ? rawPage
        : 1;
  const query = new URLSearchParams({
    q,
    diet,
    page: String(page),
    pageSize: "24",
  });
  const response = await fetch(
    `http://127.0.0.1:3001/api/v1/catalog/recipes?${query}`,
    { cache: "no-store" },
  );
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("Rezepte konnten nicht geladen werden.");
  const data: PublicCatalogResponse = await response.json();
  const link = (target: number) => {
    const params = new URLSearchParams(query);
    params.delete("pageSize");
    params.set("page", String(target));
    return `/entdecken?${params}`;
  };
  return (
    <main className="public-catalog">
      <header className="catalog-nav">
        <a className="wordmark" href="/entdecken">
          rezepte.
        </a>
        <a className="button secondary" href="/">
          Anmelden
        </a>
      </header>
      <section className="catalog-heading">
        <span className="eyebrow">Inspiration für deine Küche</span>
        <h1>Rezepte entdecken</h1>
        <p>Neue Lieblingsgerichte finden. Ohne Anmeldung, direkt zum Rezept.</p>
      </section>
      <form className="catalog-search" action="/entdecken" method="get">
        <label>
          Rezepte suchen
          <input
            name="q"
            placeholder="Gericht, Kategorie oder Tag …"
            defaultValue={q}
            maxLength={200}
          />
        </label>
        <label>
          Ernährung
          <select name="diet" defaultValue={diet}>
            <option value="all">Alle Rezepte</option>
            <option value="vegetarian">Vegetarisch</option>
            <option value="vegan">Vegan</option>
          </select>
        </label>
        <button className="button primary" type="submit">
          Suchen
        </button>
      </form>
      <p className="muted">
        {data.total} {data.total === 1 ? "Rezept" : "Rezepte"}
        {q ? ` für „${q}“` : ""}
      </p>
      {data.recipes.length ? (
        <div className="catalog-grid">
          {data.recipes.map((recipe) => (
            <a
              className="catalog-card"
              key={recipe.id}
              href={`/entdecken/${recipe.id}`}
            >
              <div className="catalog-cover">
                {recipe.images[0] ? (
                  <img src={recipe.images[0].url} alt="" loading="lazy" />
                ) : (
                  <span aria-hidden="true">✦</span>
                )}
              </div>
              <div className="catalog-card-body">
                <div className="eyebrow">
                  {recipe.vegan
                    ? "Vegan"
                    : recipe.vegetarian
                      ? "Vegetarisch"
                      : recipe.categories[0] || "Aus der Küche"}
                </div>
                <h2>{recipe.title}</h2>
                <p>{recipe.description}</p>
                <small>
                  {recipe.prepMinutes + recipe.cookMinutes} min ·{" "}
                  {recipe.servings} Portionen
                </small>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <section className="panel catalog-empty">
          <h2>
            {data.total
              ? "Diese Seite enthält keine Rezepte."
              : q || diet !== "all"
                ? "Keine passenden Rezepte gefunden."
                : "Hier wächst eine Sammlung guter Rezepte."}
          </h2>
          <p>
            {q || diet !== "all"
              ? "Versuche einen anderen Suchbegriff oder zeige alle Rezepte an."
              : "Sobald Rezepte ausdrücklich veröffentlicht werden, kannst du sie hier entdecken."}
          </p>
          {(q || diet !== "all" || page > 1) && (
            <a href="/entdecken">Alle Rezepte anzeigen</a>
          )}
        </section>
      )}
      {(page > 1 || page * data.pageSize < data.total) && (
        <nav className="catalog-pagination" aria-label="Rezeptseiten">
          {page > 1 && (
            <a className="button secondary" href={link(page - 1)}>
              ← Zurück
            </a>
          )}
          <span>Seite {page}</span>
          {page * data.pageSize < data.total && (
            <a className="button secondary" href={link(page + 1)}>
              Weiter →
            </a>
          )}
        </nav>
      )}
    </main>
  );
}
