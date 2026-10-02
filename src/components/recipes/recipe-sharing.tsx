"use client";
import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import type { RecipeDetail } from "../../../shared/recipes";
import type { RecipeAccess } from "../../../shared/recipe-access";
import { api } from "../api";
import type { Locale } from "../translations";
import { recipeMessages } from "./messages";
import { roleLabel } from "../households/messages";
export function RecipeSharing({
  recipe,
  locale,
  onRecipe,
}: {
  recipe: RecipeDetail;
  locale: Locale;
  onRecipe: (recipe: RecipeDetail) => void;
}) {
  const t = recipeMessages[locale];
  const [access, setAccess] = useState<RecipeAccess | null>(null);
  const [grants, setGrants] = useState<RecipeAccess["grants"]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    api<RecipeAccess>(`/recipes/${recipe.id}/access`)
      .then((result) => {
        if (active) {
          setAccess(result);
          setGrants(result.grants);
        }
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : t.failed);
      });
    return () => {
      active = false;
    };
  }, [recipe.id, recipe.revision, t.failed]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await api<{ recipe: RecipeDetail }>(
        `/recipes/${recipe.id}/access`,
        { revision: recipe.revision, grants },
        "PUT",
      );
      onRecipe(result.recipe);
      setSaved(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : t.failed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel recipe-sharing">
      <h2>
        <Users size={20} />
        {t.access}
      </h2>
      <p className="small muted">{t.accessHint}</p>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {saved && <p role="status">{t.accessSaved}</p>}
      {access &&
        (!access.members.length ? (
          <p className="muted">{t.accessNoMembers}</p>
        ) : (
          <form onSubmit={save}>
            {access.members.map((member) => (
              <label key={member.userId} className="recipe-share-row">
                <span>
                  <strong>{member.name}</strong>
                  <small>{roleLabel(locale, member.role)}</small>
                </span>
                <select
                  aria-label={`${t.access}: ${member.name}`}
                  disabled={busy}
                  value={
                    grants.find((grant) => grant.userId === member.userId)
                      ?.permission ?? "NONE"
                  }
                  onChange={(event) => {
                    setSaved(false);
                    const permission = event.target.value;
                    setGrants((previous) => [
                      ...previous.filter(
                        (grant) => grant.userId !== member.userId,
                      ),
                      ...(permission === "NONE"
                        ? []
                        : [
                            {
                              userId: member.userId,
                              permission: permission as "VIEW" | "EDIT",
                            },
                          ]),
                    ]);
                  }}
                >
                  <option value="NONE">{t.accessNone}</option>
                  <option value="VIEW">{t.accessView}</option>
                  {member.role !== "VIEWER" && (
                    <option value="EDIT">{t.accessEdit}</option>
                  )}
                </select>
              </label>
            ))}
            <button className="button secondary" disabled={busy}>
              {busy ? t.saving : t.accessSave}
            </button>
          </form>
        ))}
    </section>
  );
}
