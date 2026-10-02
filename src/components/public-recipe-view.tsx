import type { PublicRecipeResponse } from "../../shared/public-recipes";
export function PublicRecipeView({
  recipe,
  schemaOrg,
  catalog = false,
}: PublicRecipeResponse & { catalog?: boolean }) {
  return (
    <main className="public-recipe">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(schemaOrg).replace(/</g, "\\u003c"),
        }}
      />
      <a href={catalog ? "/entdecken" : "/"} className="wordmark">
        rezepte.
      </a>
      <p>
        <a href={catalog ? "/entdecken" : "/"}>
          {catalog ? "← Rezepte entdecken" : "Zur Rezeptdatenbank"}
        </a>
        <span className="public-signin">
          <a href="/">Anmelden</a>
        </span>
      </p>
      <article className="recipe-detail">
        <header className="detail-heading">
          <span className="eyebrow">
            {catalog
              ? "Öffentliches Rezept"
              : "Geteiltes Rezept · Shared recipe"}
          </span>
          <h1>{recipe.title}</h1>
          <p>{recipe.description}</p>
          <div className="recipe-facts">
            <span>{recipe.servings} Portionen / servings</span>
            <span>{recipe.prepMinutes + recipe.cookMinutes} min</span>
          </div>
        </header>
        {recipe.images[0] && (
          <div className="detail-cover">
            <img src={recipe.images[0].url} alt={recipe.title} />
          </div>
        )}
        <div className="recipe-body-grid">
          <section className="panel">
            <h2>Zutaten · Ingredients</h2>
            <ul className="ingredient-list">
              {recipe.ingredients.map((ingredient, index) => (
                <li key={index}>
                  {ingredient.group && <small>{ingredient.group}</small>}
                  <strong>
                    {[ingredient.amount, ingredient.unit, ingredient.name]
                      .filter(Boolean)
                      .join(" ")}
                  </strong>
                  {ingredient.note && <small>{ingredient.note}</small>}
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <h2>Zubereitung · Instructions</h2>
            <ol className="public-steps">
              {recipe.steps.map((step, index) => (
                <li key={index}>
                  <p>{step.instruction}</p>
                  {step.durationSeconds !== null && (
                    <small>{step.durationSeconds} s</small>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </div>
        {recipe.allergens.length > 0 && (
          <section className="panel">
            <h2>Allergene · Allergens</h2>
            <p>{recipe.allergens.join(", ")}</p>
          </section>
        )}
      </article>
    </main>
  );
}
