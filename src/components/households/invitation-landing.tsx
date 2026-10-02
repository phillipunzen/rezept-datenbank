"use client";
import { useEffect, useState } from "react";
import { Home, UserPlus } from "lucide-react";
import { api, type User } from "../api";
import type { InvitationPreview } from "../../../shared/households";
import type { Locale } from "../translations";
import { householdMessages, roleLabel } from "./messages";
export function InvitationLanding({
  token,
  user,
  locale,
  onUser,
  onAccepted,
  onCancel,
}: {
  token: string;
  user: User | null;
  locale: Locale;
  onUser: (user: User | null) => void;
  onAccepted: (user: User, householdId: string) => void;
  onCancel: () => void;
}) {
  const t = householdMessages[locale];
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState(false);
  useEffect(() => {
    let active = true;
    api<InvitationPreview>("/household-invitations/preview", { token })
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : t.failed);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, t.failed]);
  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (error) {
      setError(error instanceof Error ? error.message : t.failed);
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    await run(async () => {
      if (existing) {
        const result = await api<{ user: User }>("/auth/login", data);
        onUser(result.user);
      } else {
        const result = await api<{ user: User; household: { id: string } }>(
          "/household-invitations/register",
          { ...data, token },
        );
        onAccepted(result.user, result.household.id);
      }
    });
  }
  return (
    <main className="invitation-layout">
      <section className="panel invitation-card">
        <span className="invitation-icon">
          <UserPlus size={30} />
        </span>
        <h1>{t.invitationTitle}</h1>
        <p className="muted">{t.invitationText}</p>
        {loading && <p role="status">{t.invitationLoading}</p>}
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        {preview && (
          <>
            <div className="invitation-household">
              <Home size={21} />
              <div>
                <strong>{preview.householdName}</strong>
                <span>
                  {roleLabel(locale, preview.role)} · {preview.email}
                </span>
              </div>
            </div>
            <p className="small muted">
              {t.expires}:{" "}
              {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                new Date(preview.expiresAt),
              )}
            </p>
            {user ? (
              <div className="invitation-accept">
                <p>
                  {t.loggedIn}: <strong>{user.name}</strong>
                  <br />
                  {user.email}
                </p>
                <button
                  className="button primary full"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await api<{ household: { id: string } }>(
                        "/household-invitations/accept",
                        { token },
                      );
                      onAccepted(user, result.household.id);
                    })
                  }
                >
                  {busy ? t.busy : t.accept}
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api("/auth/logout", {});
                      onUser(null);
                      setExisting(true);
                    })
                  }
                >
                  {t.logout}
                </button>
              </div>
            ) : (
              <>
                <div className="invitation-account-tabs">
                  <button
                    className={!existing ? "active" : ""}
                    disabled={busy}
                    onClick={() => {
                      setExisting(false);
                      setError("");
                    }}
                  >
                    {t.newAccount}
                  </button>
                  <button
                    className={existing ? "active" : ""}
                    disabled={busy}
                    onClick={() => {
                      setExisting(true);
                      setError("");
                    }}
                  >
                    {t.existingAccount}
                  </button>
                </div>
                <form onSubmit={submit}>
                  {!existing && (
                    <label>
                      {t.userName}
                      <input
                        name="name"
                        required
                        maxLength={120}
                        autoComplete="name"
                        disabled={busy}
                      />
                    </label>
                  )}
                  <label>
                    {t.email}
                    <input
                      name="email"
                      type="email"
                      value={preview.email}
                      readOnly
                      required
                      autoComplete="username"
                    />
                  </label>
                  <label>
                    {t.password}
                    <input
                      name="password"
                      type="password"
                      required
                      minLength={existing ? 1 : 12}
                      maxLength={128}
                      autoComplete={
                        existing ? "current-password" : "new-password"
                      }
                      disabled={busy}
                    />
                    {!existing && <small>{t.passwordHint}</small>}
                  </label>
                  <button className="button primary full" disabled={busy}>
                    {busy ? t.busy : existing ? t.login : t.registerAccept}
                  </button>
                </form>
              </>
            )}
          </>
        )}
        <button
          className="text-button invitation-back"
          disabled={busy}
          onClick={onCancel}
        >
          {t.back}
        </button>
      </section>
    </main>
  );
}
