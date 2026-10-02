"use client";
import { useState } from "react";
import { FileJson, Upload, Archive } from "lucide-react";
import type { Locale } from "../translations";
import { api } from "../api";
import { usePlanningResource } from "../planning/use-planning";
import type { RecipeDocument } from "../../../shared/recipe-transfer";
import type { RecipeDetail } from "../../../shared/recipes";
import type { Cookbook } from "../../../shared/planning";
import type {
  ImportJobSummary,
  ImportJobDetail,
} from "../../../shared/import-jobs";
const statusLabel = (status: string, de: boolean) =>
  (
    ({
      DRAFT: de ? "Vorschau" : "Preview",
      QUEUED: de ? "Wartet" : "Queued",
      RUNNING: de ? "Läuft" : "Running",
      COMPLETED: de ? "Abgeschlossen" : "Completed",
      FAILED: de ? "Fehlgeschlagen" : "Failed",
      CANCELLED: de ? "Abgebrochen" : "Cancelled",
      CREATED: de ? "Importiert" : "Imported",
      SKIPPED: de ? "Bereits vorhanden" : "Already present",
    }) as Record<string, string>
  )[status] ?? status;
export function ImportManager({
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
  const de = locale === "de";
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [document, setDocument] = useState<RecipeDocument | null>(null),
    [selected, setSelected] = useState("");
  const jobs = usePlanningResource<{ jobs: ImportJobSummary[] }>(
    `/recipe-imports/tandoor?householdId=${householdId}`,
    { jobs: [] },
  );
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Import fehlgeschlagen",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>Import</h1>
        <p>
          {de
            ? "Bestehende Rezepte übernehmen: Website-Links im Rezepteditor, Rezeptdatenbank-JSON oder Tandoor-Default-ZIP."
            : "Bring existing recipes: website links in the recipe editor, Recipe Database JSON or Tandoor Default ZIP."}
        </p>
      </div>
      {(error || jobs.error) && (
        <p className="error-box" role="alert">
          {error || jobs.error}
        </p>
      )}
      {!canEdit ? (
        <p className="muted">
          {de ? "Du hast hier Leserechte." : "You have read access here."}
        </p>
      ) : (
        <div className="import-grid">
          <section className="panel">
            <h2>
              <FileJson size={20} /> JSON
            </h2>
            <label>
              {de
                ? "Rezeptdatei wählen (max. 24 MiB)"
                : "Choose recipe file (max. 24 MiB)"}
              <input
                type="file"
                accept="application/json,.json"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setDocument(null);
                  void run(async () => {
                    if (file.size > 24 * 1024 * 1024)
                      throw new Error(
                        de ? "Datei zu groß." : "File too large.",
                      );
                    let value: unknown;
                    try {
                      value = JSON.parse(await file.text());
                    } catch {
                      throw new Error(
                        de ? "Ungültige JSON-Datei." : "Invalid JSON file.",
                      );
                    }
                    setDocument(
                      (
                        await api<{ document: RecipeDocument }>(
                          "/recipe-imports/json/preview",
                          { document: value },
                        )
                      ).document,
                    );
                  });
                }}
              />
            </label>
            {document && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void run(async () => {
                    const result = await api<{ recipe: RecipeDetail }>(
                      "/recipe-imports/json",
                      {
                        householdId,
                        visibility: data.get("visibility"),
                        document,
                      },
                    );
                    onRecipe(result.recipe.id);
                  });
                }}
              >
                <h3>{document.recipe.title}</h3>
                <p>
                  {document.recipe.ingredients.length}{" "}
                  {de ? "Zutaten" : "ingredients"} ·{" "}
                  {document.recipe.steps.length} {de ? "Schritte" : "steps"} ·{" "}
                  {document.images.length} {de ? "Bilder" : "images"}
                </p>
                {document.images[0] && (
                  <img
                    className="import-preview-image"
                    src={document.images[0]}
                    alt=""
                  />
                )}
                <p>{document.recipe.description}</p>
                <details>
                  <summary>{de ? "Vorschau öffnen" : "Open preview"}</summary>
                  <ul>
                    {document.recipe.ingredients.map((ingredient, index) => (
                      <li key={index}>
                        {[ingredient.amount, ingredient.unit, ingredient.name]
                          .filter(Boolean)
                          .join(" ")}
                      </li>
                    ))}
                  </ul>
                  <ol>
                    {document.recipe.steps.map((step, index) => (
                      <li key={index}>{step.instruction}</li>
                    ))}
                  </ol>
                </details>
                <label>
                  {de ? "Sichtbarkeit" : "Visibility"}
                  <select name="visibility" defaultValue="PRIVATE">
                    <option value="PRIVATE">{de ? "Privat" : "Private"}</option>
                    <option value="HOUSEHOLD">
                      {de ? "Haushalt" : "Household"}
                    </option>
                  </select>
                </label>
                {Boolean(document.devices?.length) && (
                  <label className="ingredient-checkbox">
                    <input type="checkbox" required />
                    {de
                      ? "Enthaltene Geräteparameter geprüft und bestätigt."
                      : "Included device settings reviewed and confirmed."}
                  </label>
                )}
                <button className="button primary" disabled={busy}>
                  <Upload size={17} />
                  {de ? "Rezept importieren" : "Import recipe"}
                </button>
              </form>
            )}
          </section>
          <section className="panel">
            <h2>
              <Archive size={20} /> Tandoor
            </h2>
            <p className="muted">
              {de
                ? "In Tandoor unter Import/Export den Typ Default wählen und als ZIP exportieren. Keine Installation-/Datenbanksicherung verwenden."
                : "Choose Default under Import/Export in Tandoor and export as ZIP. Do not use an installation/database backup."}
            </p>
            <label>
              {de
                ? "ZIP wählen (max. 64 MiB, 1000 Rezepte)"
                : "Choose ZIP (max. 64 MiB, 1000 recipes)"}
              <input
                type="file"
                accept=".zip,application/zip"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void run(async () => {
                    if (file.size > 64 * 1024 * 1024)
                      throw new Error(
                        de ? "Datei zu groß." : "File too large.",
                      );
                    const form = new FormData();
                    form.set("file", file);
                    const response = await fetch(
                      `/api/v1/recipe-imports/tandoor?householdId=${householdId}`,
                      {
                        method: "POST",
                        body: form,
                        credentials: "same-origin",
                      },
                    );
                    const value = await response.json();
                    if (!response.ok) throw new Error(value.message);
                    setSelected(value.id);
                    jobs.refresh();
                  });
                }}
              />
            </label>
            <p className="small muted">
              {de
                ? "Der Upload erstellt zuerst eine Vorschau. Rezepte werden erst nach „Import starten“ gespeichert."
                : "Uploading first creates a preview. Recipes are only saved after Start import."}
            </p>
          </section>
        </div>
      )}
      <section className="panel">
        <h2>{de ? "Meine Tandoor-Importe" : "My Tandoor imports"}</h2>
        {jobs.data.jobs.map((job) => (
          <button
            key={job.id}
            className="collection-tab"
            onClick={() => setSelected(job.id)}
          >
            <Archive size={16} />
            <span>
              {new Intl.DateTimeFormat(locale, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(job.createdAt))}
            </span>
            <small>{statusLabel(job.status, de)}</small>
          </button>
        ))}
      </section>
      {selected && (
        <JobDetail
          key={selected}
          id={selected}
          householdId={householdId}
          locale={locale}
          canEdit={canEdit}
          onRecipe={onRecipe}
          onDelete={() => {
            setSelected("");
            jobs.refresh();
          }}
        />
      )}
    </>
  );
}
function JobDetail({
  id,
  householdId,
  locale,
  canEdit,
  onRecipe,
  onDelete,
}: {
  id: string;
  householdId: string;
  locale: Locale;
  canEdit: boolean;
  onRecipe: (id: string) => void;
  onDelete: () => void;
}) {
  const de = locale === "de";
  const resource = usePlanningResource<ImportJobDetail | null>(
    `/recipe-imports/tandoor/${id}`,
    null,
  );
  const books = usePlanningResource<{ cookbooks: Cookbook[] }>(
    `/cookbooks?householdId=${householdId}`,
    { cookbooks: [] },
  );
  const job = resource.data;
  if (!job)
    return (
      <p role={resource.error ? "alert" : undefined}>
        {resource.error ||
          (de ? "Vorschau wird geladen …" : "Loading preview …")}
      </p>
    );
  const active = ["RUNNING", "QUEUED"].includes(job.status);
  return (
    <section className="panel import-job">
      <h2>{de ? "Importvorschau und Bericht" : "Import preview and report"}</h2>
      <p className="recipe-facts">
        <strong>
          {job.preview.recipes} {de ? "Rezepte" : "recipes"}
        </strong>
        <span>
          {job.preview.valid} {de ? "gültig" : "valid"}
        </span>
        <span>
          {job.preview.ingredients} {de ? "Zutaten" : "ingredients"}
        </span>
        <span>
          {job.preview.images} {de ? "Bilder" : "images"}
        </span>
        <span>{job.preview.tags} Tags</span>
      </p>
      <p className="small muted">
        {de
          ? job.preview.notice
          : "Default exports do not contain ratings, favorites or cookbook assignments."}
      </p>
      {(resource.error || job.error) && (
        <p className="error-box" role="alert">
          {resource.error || job.error}
        </p>
      )}
      {canEdit &&
        (["DRAFT", "FAILED", "CANCELLED"].includes(job.status) ||
          (job.status === "COMPLETED" &&
            job.results.some((result) => result.status === "FAILED"))) && (
          <form
            className="inline-resource-form"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void resource.run(() =>
                api(`/recipe-imports/tandoor/${id}/start`, {
                  visibility: data.get("visibility"),
                  targetBookId: data.get("bookId") || null,
                }),
              );
            }}
          >
            <label>
              {de ? "Sichtbarkeit" : "Visibility"}
              <select
                name="visibility"
                defaultValue={job.visibility}
                disabled={job.status !== "DRAFT"}
              >
                <option value="PRIVATE">{de ? "Privat" : "Private"}</option>
                <option value="HOUSEHOLD">
                  {de ? "Haushalt" : "Household"}
                </option>
              </select>
              {job.status !== "DRAFT" && (
                <input type="hidden" name="visibility" value={job.visibility} />
              )}
            </label>
            <label>
              {de ? "Zielbuch (optional)" : "Target cookbook (optional)"}
              <select
                name="bookId"
                defaultValue={job.targetBookId ?? ""}
                disabled={job.status !== "DRAFT"}
              >
                <option value="">—</option>
                {books.data.cookbooks.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.name}
                  </option>
                ))}
              </select>
              {job.status !== "DRAFT" && (
                <input
                  type="hidden"
                  name="bookId"
                  value={job.targetBookId ?? ""}
                />
              )}
            </label>
            <button
              className="button primary"
              disabled={resource.busy || !job.preview.valid}
            >
              {de ? "Import starten" : "Start import"}
            </button>
          </form>
        )}
      <p role="status">
        {de ? "Status" : "Status"}: {statusLabel(job.status, de)} ·{" "}
        {job.results.filter((r) => r.status === "CREATED").length}{" "}
        {de ? "importiert" : "imported"} ·{" "}
        {job.results.filter((r) => r.status === "SKIPPED").length}{" "}
        {de ? "bereits vorhanden" : "already present"} ·{" "}
        {job.results.filter((r) => r.status === "FAILED").length}{" "}
        {de ? "fehlgeschlagen" : "failed"}
      </p>
      <details>
        <summary>{de ? "Gefundene Rezepte" : "Found recipes"}</summary>
        {job.preview.entries.map((entry, index) => (
          <div className="history-row" key={index}>
            <span>
              <strong>{entry.title}</strong>
              <small>
                {[entry.error, ...entry.warnings].filter(Boolean).join(" · ")}
              </small>
            </span>
          </div>
        ))}
      </details>
      {job.results.map((result) => (
        <div className="history-row" key={result.position}>
          <span>
            <strong>{result.title}</strong>
            <small>
              {statusLabel(result.status, de)} {result.message}
            </small>
          </span>
          {result.recipeId && (
            <button
              className="button secondary"
              onClick={() => onRecipe(result.recipeId!)}
            >
              {de ? "Rezept öffnen" : "Open recipe"}
            </button>
          )}
        </div>
      ))}
      <div className="detail-actions">
        {active && canEdit && (
          <button
            className="button secondary"
            disabled={resource.busy}
            onClick={() =>
              void resource.run(() =>
                api(`/recipe-imports/tandoor/${id}/cancel`, {}, "POST"),
              )
            }
          >
            {de ? "Abbrechen" : "Cancel"}
          </button>
        )}
        {!active && (
          <button
            className="text-button danger"
            disabled={resource.busy}
            onClick={() => {
              if (
                window.confirm(
                  de
                    ? "Bericht und Archiv löschen? Importierte Rezepte bleiben erhalten."
                    : "Delete report and archive? Imported recipes are kept.",
                )
              )
                void resource
                  .run(() =>
                    api(`/recipe-imports/tandoor/${id}`, undefined, "DELETE"),
                  )
                  .then((success) => {
                    if (success) onDelete();
                  });
            }}
          >
            {de ? "Bericht und Archiv löschen" : "Delete report and archive"}
          </button>
        )}
      </div>
    </section>
  );
}
