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

export const detectLang = () => (typeof navigator !== 'undefined' && navigator.language?.startsWith('de') ? 'de' : (navigator.language ? 'en' : 'de'));
