"use client";
import { AccountOptions } from "./account-options";
import { useState } from "react";
import { ArrowRight, CookingPot, Leaf } from "lucide-react";
import { api, type System, type User } from "./api";
import { messages, type Locale } from "./translations";
export function AuthForm({
  system,
  locale,
  setLocale,
  onUser,
  externalError,
}: {
  system: System;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  onUser: (user: User) => void;
  externalError?: string;
}) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = messages[locale];
  const setup = system.setupRequired;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api<{ user: User }>(
        `/auth/${setup ? "setup" : register ? "register" : "login"}`,
        data,
      );
      onUser(result.user);
    } catch (error) {
      setError(error instanceof Error ? error.message : t.unavailable);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <div className="brand">
          <span className="brand-icon">
            <CookingPot size={24} />
          </span>{" "}
          rezeptdatenbank<span className="brand-dot">.</span>
        </div>
        <div className="auth-story-content">
          <div className="eyebrow">
            <Leaf size={16} /> {t.home}
          </div>
          <h1>{t.welcomeTitle}</h1>
          <p>{t.tagline}</p>
          <div className="bowl-art" aria-hidden="true">
            <span className="herb herb-one" />
            <span className="herb herb-two" />
            <span className="tomato" />
            <span className="noodle" />
            <div className="bowl" />
            <span className="art-caption">{t.decor}</span>
          </div>
        </div>
        <div className="story-footer">SELF-HOSTED · MADE FOR YOUR KITCHEN</div>
      </section>
      <section className="auth-panel">
        <div className="auth-top">
          <select
            aria-label={t.language}
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
          >
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
        </div>
        <div className="auth-card">
          <span className="eyebrow">{t.cookingTagline}</span>
          <h2>
            {setup ? t.setupTitle : register ? t.registerTitle : t.loginTitle}
          </h2>
          <p className="muted">{setup ? t.setupText : t.loginText}</p>
          <form onSubmit={submit}>
            {setup && (
              <label>
                {t.code}
                <input
                  aria-label={t.code}
                  name="setupToken"
                  type="password"
                  minLength={32}
                  maxLength={256}
                  autoComplete="off"
                  required
                />
                <small>{t.setupHelp}</small>
              </label>
            )}
            {(setup || register) && (
              <label>
                {t.name}
                <input
                  name="name"
                  maxLength={120}
                  autoComplete="name"
                  placeholder={locale === "de" ? "Dein Name" : "Your name"}
                  required
                />
              </label>
            )}
            <label>
              {t.email}
              <input
                name="email"
                type="email"
                maxLength={254}
                autoComplete="username"
                placeholder="du@zuhause.de"
                required
              />
            </label>
            <label>
              {t.password}
              <input
                aria-label={t.password}
                name="password"
                type="password"
                minLength={setup || register ? 12 : 1}
                maxLength={128}
                autoComplete={
                  setup || register ? "new-password" : "current-password"
                }
                required
              />
              {(setup || register) && <small>{t.passwordHint}</small>}
            </label>
            {(setup || register) && (
              <label>
                {t.householdName}
                <input
                  name="householdName"
                  defaultValue="Zuhause"
                  maxLength={120}
                  required
                />
              </label>
            )}
            {(error || externalError) && (
              <div role="alert" className="error-box">
                {error || externalError}
              </div>
            )}
            <button className="button primary full" disabled={busy}>
              {busy
                ? t.work
                : setup
                  ? t.setupAction
                  : register
                    ? t.register
                    : t.login}
              <ArrowRight size={18} />
            </button>
          </form>
          {!setup && system.registrationEnabled && (
            <button
              className="text-button"
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register ? t.backLogin : t.register}
            </button>
          )}
          {!setup && system.publicCatalogEnabled && (
            <a className="button secondary full" href="/entdecken">
              {locale === "de" ? "Rezepte entdecken" : "Discover recipes"}
            </a>
          )}
          {!setup && !register && <AccountOptions locale={locale} />}
        </div>
        <div className="auth-bottom">
          v{system.version}
        </div>
      </section>
    </main>
  );
}
