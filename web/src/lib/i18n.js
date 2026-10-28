// Übersetzungen: Die Oberfläche ist auf Deutsch geschrieben; en.js enthält die englischen Texte.
import { createContext, useContext } from 'react';
import en from './en.js';

export const LangContext = createContext('de');

export function translate(lang, key, vars) {
  let s = lang === 'en' ? en[key] ?? key : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

export function useT() {
  const lang = useContext(LangContext);
  const t = (key, vars) => translate(lang, key, vars);
  t.lang = lang;
  return t;
}

/** Erste unterstützte Sprache aus den bevorzugten Browsersprachen (nicht der Oberflächensprache). */
export function detectLang() {
  if (typeof navigator === 'undefined') return 'de';
  const list = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const l of list) {
    const code = String(l || '').toLowerCase().slice(0, 2);
    if (code === 'de' || code === 'en') return code;
  }
  return 'de';
}

/** Gespeicherte Wahl ('de' | 'en') oder automatisch erkannt. */
export function resolveLang(pref) {
  return pref === 'de' || pref === 'en' ? pref : detectLang();
}
