"use client";
import { AccountManagement } from "./account-management";
import { useState } from "react";
import { Save, ShieldCheck } from "lucide-react";
import { api, type User } from "./api";
import { AppearancePicker, type ThemePreference } from "./theme";
import { messages, type Locale } from "./translations";
export function Profile({
  user,
  locale,
  onUser,
  appearance,
  onAppearance,
}: {
  user: User;
  locale: Locale;
  onUser: (user: User) => void;
  appearance: ThemePreference;
  onAppearance: (theme: ThemePreference) => void;
}) {
  const t = messages[locale];
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(
    event: React.FormEvent<HTMLFormElement>,
    password: boolean,
  ) {
    event.preventDefault();
    setBusy(true);
    setFeedback("");
    setError("");
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
      if (password) {
        await api("/auth/password", data);
        form.reset();
        setFeedback(t.passwordChanged);
      } else {
        const result = await api<{ user: User }>(
          "/auth/profile",
          data,
          "PATCH",
        );
        onUser(result.user);
        setFeedback(t.saved);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : t.unavailable);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">{t.account}</span>
        <h1>{t.settings}</h1>
      </div>
      <section className="panel appearance-settings">
        <h2>{t.appearance}</h2>
        <p className="small muted">{t.appearanceHint}</p>
        <AppearancePicker
          preference={appearance}
          onChange={onAppearance}
          locale={locale}
        />
      </section>
      <div className="profile-grid">
        <section className="panel">
          <h2>{t.profile}</h2>
          <form onSubmit={(event) => save(event, false)}>
            <label>
              {t.name}
              <input
                name="name"
                defaultValue={user.name}
                maxLength={120}
                required
              />
            </label>
            <label>
              {t.email}
              <input value={user.email} readOnly className="readonly" />
            </label>
            <label>
              {t.language}
              <select
                aria-label={t.language}
                name="locale"
                defaultValue={user.locale}
              >
                <option value="de">Deutsch</option>
                <option value="en">English</option>
              </select>
            </label>
            <button className="button primary" disabled={busy}>
              <Save size={16} />
              {t.save}
            </button>
          </form>
        </section>
        <section className="panel">
          <h2>
            <ShieldCheck size={20} />
            {t.passwordChange}
          </h2>
          <form onSubmit={(event) => save(event, true)}>
            <label>
              {t.currentPassword}
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                maxLength={128}
                required
              />
            </label>
            <label>
              {t.newPassword}
              <input
                aria-label={t.newPassword}
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
              <small>{t.passwordHint}</small>
            </label>
            <button className="button secondary" disabled={busy}>
              {t.passwordChange}
            </button>
          </form>
        </section>
      </div>
      <section className="panel">
        <h2>{locale === "de" ? "Offline-Küche" : "Offline kitchen"}</h2>
        <p className="muted">
          {locale === "de"
            ? "Rezepte, Wochenplan und Einkaufslisten verschlüsselt auf diesem Gerät speichern. Offline-Häkchen werden nach einer Konfliktprüfung synchronisiert. HTTPS ist erforderlich."
            : "Store encrypted recipes, this week and shopping lists on this device. Offline checkmarks sync after checking conflicts. HTTPS is required."}
        </p>
        <a className="button secondary" href="/offline.html">
          {locale === "de" ? "Offline-Küche öffnen" : "Open offline kitchen"}
        </a>
      </section>
      <AccountManagement user={user} locale={locale} />
      {feedback && (
        <div className="success-box" role="status">
          {feedback}
        </div>
      )}
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
