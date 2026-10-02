"use client";
import { useState } from "react";
import { Download, Link as LinkIcon } from "lucide-react";
import { api } from "../api";
import type { Locale } from "../translations";
import type { RecipeImportPreview } from "../../../shared/recipe-import";
import { recipeMessages } from "./messages";

export function RecipeUrlImport({
  householdId,
  locale,
  busy,
  onLoading,
  onReplace,
  onImport,
}: {
  householdId: string;
  locale: Locale;
  busy: boolean;
  onLoading: (loading: boolean) => void;
  onReplace: () => boolean;
  onImport: (preview: RecipeImportPreview) => void;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const t = recipeMessages[locale];
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || loading || !onReplace()) return;
    setLoading(true);
    onLoading(true);
    setError("");
    try {
      const preview = await api<RecipeImportPreview>(
        "/recipe-imports/preview",
        { householdId, url: url.trim() },
      );
      onImport(preview);
    } catch (error) {
      setError(error instanceof Error ? error.message : t.failed);
    } finally {
      setLoading(false);
      onLoading(false);
    }
  }
  return (
    <section className="panel recipe-url-import">
      <h2>
        <LinkIcon size={19} />
        {t.importTitle}
      </h2>
      <p className="muted small">{t.importHint}</p>
      <form onSubmit={submit}>
        <label>
          {t.importUrl}
          <input
            type="url"
            required
            maxLength={2048}
            value={url}
            disabled={busy || loading}
            placeholder="https://…"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <button
          className="button secondary"
          type="submit"
          disabled={busy || loading || !url.trim()}
        >
          <Download size={17} />
          {loading ? t.importing : t.importAction}
        </button>
      </form>
      {loading && (
        <p className="small muted" role="status">
          {t.importing}
        </p>
      )}
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
