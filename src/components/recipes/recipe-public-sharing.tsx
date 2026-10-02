"use client";
import { useState } from "react";
import { Share2, Link2 } from "lucide-react";
import { api } from "../api";
import type { RecipeDetail } from "../../../shared/recipes";
import type { Locale } from "../translations";
import { usePlanningResource } from "../planning/use-planning";
interface Link {
  id: string;
  expiresAt: string;
  revokedAt: string | null;
}
export function RecipePublicSharing({
  recipe,
  locale,
}: {
  recipe: RecipeDetail;
  locale: Locale;
}) {
  const de = locale === "de";
  const [open, setOpen] = useState(false),
    [created, setCreated] = useState<{ url: string; qrUrl: string } | null>(
      null,
    );
  const resource = usePlanningResource<{ links: Link[] }>(
    `/recipes/${recipe.id}/share-links`,
    { links: [] },
  );
  return (
    <section className="panel recipe-public-sharing no-print">
      <h2>
        <Share2 size={19} /> {de ? "Per Link teilen" : "Share with a link"}
      </h2>
      <button className="button secondary" onClick={() => setOpen(!open)}>
        {de ? "Öffentliche Links verwalten" : "Manage public links"}
      </button>
      {open && (
        <>
          <p className="muted">
            {de
              ? "Jeder mit dem Link kann Rezepttext, Zutaten und Bilder öffnen. Quellenangaben, persönliche Notizen und Bewertungen werden nicht geteilt. Links sind widerrufbar; eine Annahme durch Cookidoo ist bisher nicht bestätigt."
              : "Anyone with the link can view recipe text, ingredients and images. Sources, personal notes and ratings are not shared. Links can be revoked; Cookidoo acceptance has not been verified."}
          </p>
          {recipe.canEdit && !recipe.deletedAt && (
            <form
              className="inline-resource-form"
              onSubmit={(event) => {
                event.preventDefault();
                const days = Number(
                  new FormData(event.currentTarget).get("days"),
                );
                void resource.run(async () =>
                  setCreated(
                    await api(`/recipes/${recipe.id}/share-links`, {
                      days,
                      revision: recipe.revision,
                    }),
                  ),
                );
              }}
            >
              <label>
                {de ? "Gültigkeit (Tage)" : "Validity (days)"}
                <input
                  name="days"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={30}
                  required
                />
              </label>
              <label className="ingredient-checkbox">
                <input type="checkbox" required />
                {de
                  ? "Ich möchte dieses Rezept öffentlich teilen."
                  : "I want to share this recipe publicly."}
              </label>
              <button className="button primary" disabled={resource.busy}>
                <Link2 size={17} />
                {de ? "Link erstellen" : "Create link"}
              </button>
            </form>
          )}
          {created && (
            <div className="created-share">
              <label>
                {de ? "Freigabelink (jetzt kopieren)" : "Share link (copy now)"}
                <input
                  readOnly
                  value={created.url}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <a href={created.url} target="_blank" rel="noreferrer">
                {de ? "Freigabe öffnen" : "Open shared recipe"}
              </a>
              <img src={created.qrUrl} alt="QR" width={180} height={180} />
            </div>
          )}
          {resource.error && (
            <p role="alert" className="error-box">
              {resource.error}
            </p>
          )}
          {resource.data.links.map((link) => (
            <div className="history-row" key={link.id}>
              <span>
                {de ? "Gültig bis" : "Valid until"}{" "}
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                }).format(new Date(link.expiresAt))}
                {link.revokedAt && ` · ${de ? "Widerrufen" : "Revoked"}`}
              </span>
              {!link.revokedAt && (
                <button
                  className="button secondary"
                  disabled={resource.busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        de ? "Link widerrufen?" : "Revoke this link?",
                      )
                    )
                      void resource.run(() =>
                        api(
                          `/recipes/${recipe.id}/share-links/${link.id}`,
                          undefined,
                          "DELETE",
                        ),
                      );
                  }}
                >
                  {de ? "Widerrufen" : "Revoke"}
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
