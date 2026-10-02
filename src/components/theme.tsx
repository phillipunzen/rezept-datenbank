"use client";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { messages, type Locale } from "./translations";
import { appearanceStorageKey as storageKey } from "./theme-config";

export type ThemePreference = "system" | "light" | "dark";
export function useAppearance() {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === "light" || saved === "dark") setPreference(saved);
    } catch {
      /* Storage may be disabled; system appearance still works. */
    }
    setReady(true);
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey)
        setPreference(
          event.newValue === "light" || event.newValue === "dark"
            ? event.newValue
            : "system",
        );
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark =
        preference === "dark" || (preference === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
      document
        .querySelectorAll('meta[name="theme-color"]')
        .forEach((meta) =>
          meta.setAttribute("content", dark ? "#141619" : "#ffffff"),
        );
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference, ready]);
  function choose(next: ThemePreference) {
    setPreference(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      /* Keep the choice for this page. */
    }
  }
  return { preference, choose };
}

export function AppearancePicker({
  preference,
  onChange,
  locale,
  compact = false,
}: {
  preference: ThemePreference;
  onChange: (theme: ThemePreference) => void;
  locale: Locale;
  compact?: boolean;
}) {
  const t = messages[locale];
  return (
    <label className={`appearance-picker ${compact ? "compact" : ""}`}>
      <span className={compact ? "visually-hidden" : ""}>{t.appearance}</span>
      <span className="appearance-input">
        {preference === "system" ? (
          <Monitor size={16} aria-hidden="true" />
        ) : preference === "dark" ? (
          <Moon size={16} aria-hidden="true" />
        ) : (
          <Sun size={16} aria-hidden="true" />
        )}
        <select
          aria-label={t.appearance}
          value={preference}
          onChange={(event) => onChange(event.target.value as ThemePreference)}
        >
          <option value="system">{t.systemTheme}</option>
          <option value="light">{t.lightTheme}</option>
          <option value="dark">{t.darkTheme}</option>
        </select>
      </span>
    </label>
  );
}
