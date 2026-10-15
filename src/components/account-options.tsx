"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import type { Locale } from "./translations";
interface Options {
  passwordResetEnabled: boolean;
  oidcEnabled: boolean;
  oidcLabel: string;
}
export function AccountOptions({
  locale,
  link = false,
}: {
  locale: Locale;
  link?: boolean;
}) {
  const de = locale === "de";
  const [options, setOptions] = useState<Options | null>(null),
    [open, setOpen] = useState(false),
    [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const authentik = /authentik/i.test(options?.oidcLabel ?? "");
  useEffect(() => {
    let active = true;
    api<Options>("/auth/options")
      .then((o) => {
        if (active) setOptions(o);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-options">
      {options?.oidcEnabled && (
        <button
          className={`button ${authentik ? "authentik-signin" : "secondary"}`}
          disabled={busy}
          aria-busy={busy}
          onClick={() =>
            void run(async () => {
              const result = await api<{ url: string }>("/auth/oidc/start", {
                link,
              });
              window.location.assign(result.url);
            })
          }
        >
          {authentik && (
            <span className="authentik-mark" aria-hidden="true">
              <img src="/brands/authentik.svg" alt="" width={24} height={24} />
            </span>
          )}
          {link
            ? de
              ? "Anmeldekonto verknüpfen"
              : "Link sign-in account"
            : options.oidcLabel}
        </button>
      )}
      {!link && options?.passwordResetEnabled && (
        <button className="text-button" onClick={() => setOpen(!open)}>
          {de ? "Passwort vergessen?" : "Forgot password?"}
        </button>
      )}
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const email = new FormData(e.currentTarget).get("email");
            void run(async () => {
              const result = await api<{ message: string }>(
                "/auth/reset/request",
                { email },
              );
              setFeedback(result.message);
            });
          }}
        >
          <label>
            {de ? "E-Mail für Passwortreset" : "Password reset email"}
            <input name="email" type="email" required maxLength={254} />
          </label>
          <button className="button secondary" disabled={busy}>
            {de ? "Reset-Link anfordern" : "Request reset link"}
          </button>
        </form>
      )}
      {!link && options && !options.passwordResetEnabled && (
        <p className="small muted">
          {de
            ? "Für Passwortreset muss der Administrator den Mailversand einrichten."
            : "Password reset requires the administrator to configure email delivery."}
        </p>
      )}
      {feedback && (
        <p role="status" className="success-box">
          {feedback}
        </p>
      )}
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
    </div>
  );
}
export function PasswordReset({
  locale,
  onDone,
}: {
  locale: Locale;
  onDone: () => void;
}) {
  const de = locale === "de",
    [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setToken(new URLSearchParams(location.hash.slice(1)).get("reset") ?? "");
    history.replaceState(null, "", location.pathname);
  }, []);
  return (
    <main className="auth-layout">
      <section className="auth-panel">
        <div className="auth-card">
          <h1>{de ? "Passwort zurücksetzen" : "Reset password"}</h1>
          {done ? (
            <>
              <p role="status">
                {de
                  ? "Passwort geändert. Bitte neu anmelden."
                  : "Password changed. Please sign in again."}
              </p>
              <button className="button primary" onClick={onDone}>
                {de ? "Zur Anmeldung" : "Back to sign-in"}
              </button>
            </>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                const password = new FormData(e.currentTarget).get("password");
                try {
                  await api("/auth/reset/confirm", { token, password });
                  setDone(true);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Fehler");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                {de ? "Neues Passwort" : "New password"}
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </label>
              {error && (
                <p className="error-box" role="alert">
                  {error}
                </p>
              )}
              <button className="button primary" disabled={busy}>
                {de ? "Passwort speichern" : "Save password"}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
