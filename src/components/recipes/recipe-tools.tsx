"use client";
import { useState } from "react";
import { Copy, Download, History, RotateCcw } from "lucide-react";
import type { RecipeDetail } from "../../../shared/recipes";
import { api } from "../api";
import type { Locale } from "../translations";
export function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function RecipeTools({
  recipe,
  locale,
  canCreate,
  onRecipe,
  onDuplicate,
  onBusy,
}: {
  recipe: RecipeDetail;
  locale: Locale;
  canCreate: boolean;
  onRecipe: (recipe: RecipeDetail) => void;
  onDuplicate: (recipe: RecipeDetail) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const de = locale === "de";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [versions, setVersions] = useState<Array<{
    revision: number;
    createdAt: string;
    author: { name: string };
  }> | null>(null);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    onBusy?.(true);
    setError("");
    try {
      await work();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Fehler");
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }
  return (
    <section className="panel recipe-tools no-print">
      <h2>{de ? "Rezept verwalten" : "Manage recipe"}</h2>
      <div className="detail-actions">
        {canCreate && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void run(async () =>
                onDuplicate(
                  (
                    await api<{ recipe: RecipeDetail }>(
                      `/recipes/${recipe.id}/duplicate`,
                      {},
                      "POST",
                    )
                  ).recipe,
                ),
              )
            }
          >
            <Copy size={17} />
            {de ? "Duplizieren" : "Duplicate"}
          </button>
        )}
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            void run(async () =>
              downloadJson(
                await api(`/recipes/${recipe.id}/export`),
                `rezept-${recipe.id}.json`,
              ),
            )
          }
        >
          <Download size={17} />
          {de ? "JSON exportieren" : "Export JSON"}
        </button>
        {recipe.canEdit && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void run(async () =>
                setVersions(
                  (
                    await api<{ versions: NonNullable<typeof versions> }>(
                      `/recipes/${recipe.id}/versions`,
                    )
                  ).versions,
                ),
              )
            }
          >
            <History size={17} />
            {de ? "Versionshistorie" : "Version history"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {versions && (
        <div className="recipe-versions">
          <p className="small muted">
            {de
              ? "Wiederherstellen übernimmt Rezepttext, Zutaten und Metadaten. Aktuelle Bilder und Freigaben bleiben erhalten."
              : "Restoring applies recipe text, ingredients and metadata. Current images and permissions are kept."}
          </p>
          {!versions.length && (
            <p>
              {de
                ? "Noch keine Vorgängerversionen."
                : "No previous versions yet."}
            </p>
          )}
          {versions.map((version) => (
            <div className="history-row" key={version.revision}>
              <span>
                <strong>
                  {de ? "Version" : "Version"} {version.revision}
                </strong>
                <small>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(version.createdAt))}{" "}
                  · {version.author.name}
                </small>
              </span>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      de
                        ? `Version ${version.revision} als neuen Stand wiederherstellen?`
                        : `Restore version ${version.revision} as a new revision?`,
                    )
                  )
                    void run(async () => {
                      onRecipe(
                        (
                          await api<{ recipe: RecipeDetail }>(
                            `/recipes/${recipe.id}/versions/restore`,
                            {
                              version: version.revision,
                              revision: recipe.revision,
                            },
                          )
                        ).recipe,
                      );
                      setVersions(null);
                    });
                }}
              >
                <RotateCcw size={16} />
                {de ? "Wiederherstellen" : "Restore"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
