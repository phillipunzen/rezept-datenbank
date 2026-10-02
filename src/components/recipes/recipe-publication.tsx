"use client";
import { Globe } from "lucide-react";
import { api } from "../api";
import type { RecipeDetail } from "../../../shared/recipes";
import type { RecipePublicationStatus } from "../../../shared/public-recipes";
import type { Locale } from "../translations";
import { usePlanningResource } from "../planning/use-planning";
export function RecipePublication({
  recipe,
  locale,
}: {
  recipe: RecipeDetail;
  locale: Locale;
}) {
  const de = locale === "de";
  const resource = usePlanningResource<{
    publication: RecipePublicationStatus;
  }>(`/recipes/${recipe.id}/publication`, {
    publication: { enabled: false, published: false, revision: 0, url: null },
  });
  const p = resource.data.publication;
  return (
    <section className="panel recipe-publication no-print">
      <h2>
        <Globe size={19} /> {de ? "Öffentlich sichtbar" : "Public visibility"}
      </h2>
      <p className="muted">
        {de
          ? "Veröffentlichte Rezepte sind unter „Rezepte entdecken“ für alle ohne Anmeldung auffindbar. Quellenangaben, persönliche Notizen und Bewertungen werden ausgeblendet. Änderungen am Rezept sind auch öffentlich sichtbar."
          : "Published recipes can be found under “Discover recipes” without signing in. Sources, personal notes and ratings are hidden. Recipe edits are also visible publicly."}
      </p>
      {!resource.loading && !p.enabled && (
        <p className="muted">
          {de
            ? "Der öffentliche Katalog ist vom Betreiber deaktiviert."
            : "The public catalog has been disabled by the operator."}
        </p>
      )}
      <p>
        {p.published
          ? de
            ? "Veröffentlicht"
            : "Published"
          : de
            ? "Nicht veröffentlicht"
            : "Not published"}
      </p>
      {(p.published || (p.enabled && recipe.canEdit && !recipe.deletedAt)) && (
        <button
          className="button secondary"
          disabled={resource.loading || resource.busy}
          onClick={() => {
            const message = p.published
              ? de
                ? "Veröffentlichung zurücknehmen? Das Rezept wird aus dem öffentlichen Katalog entfernt."
                : "Withdraw publication? The recipe will be removed from the public catalog."
              : de
                ? "Dieses Rezept mit Zutaten, Schritten und Bildern für alle ohne Anmeldung veröffentlichen? Auch private Rezepte werden dadurch öffentlich auffindbar."
                : "Publish this recipe with ingredients, steps and images for everyone without signing in? This also makes private recipes publicly discoverable.";
            if (window.confirm(message))
              void resource.run(() =>
                api(
                  `/recipes/${recipe.id}/publication`,
                  {
                    published: !p.published,
                    confirmedPublic: !p.published,
                    recipeRevision: recipe.revision,
                    revision: p.revision,
                  },
                  "PUT",
                ),
              );
          }}
        >
          {p.published
            ? de
              ? "Veröffentlichung zurücknehmen"
              : "Withdraw publication"
            : de
              ? "Öffentlich veröffentlichen"
              : "Publish publicly"}
        </button>
      )}
      {p.url && (
        <p>
          <a href={p.url} target="_blank" rel="noreferrer">
            {de ? "Öffentliches Rezept öffnen" : "Open public recipe"}
          </a>
        </p>
      )}
      {p.enabled && (
        <p>
          <a href="/entdecken">
            {de ? "Rezepte entdecken" : "Discover recipes"}
          </a>
        </p>
      )}
      {resource.error && (
        <p role="alert" className="error-box">
          {resource.error}
        </p>
      )}
    </section>
  );
}
