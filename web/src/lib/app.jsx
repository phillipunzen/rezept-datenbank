// Globaler App-Zustand: angemeldeter Benutzer, Gruppen, Theme, Sprache.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, ensureEvents, closeEvents, clearApiCache } from './api.js';
import { resolveLang } from './i18n.js';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  const dark = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#15120f' : '#faf7f2');
}

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const [groups, setGroups] = useState([]);
  const [localTheme, setLocalTheme] = useState(() => localStorage.getItem('theme') || 'system');
  const [localLang, setLocalLang] = useState(() => localStorage.getItem('lang') || 'auto');

  const loadGroups = useCallback(async () => {
    try {
      const d = await api.get('/api/groups');
      setGroups(d.items || []);
    } catch { /* offline */ }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const d = await api.get('/api/auth/me');
      setUser(d.user || null);
      if (d.user) loadGroups();
      return d.user;
    } catch {
      setUser(null);
    }
  }, [loadGroups]);

  useEffect(() => { refreshUser(); }, [refreshUser]);
  useEffect(() => {
    if (user) ensureEvents(); else closeEvents();
  }, [user]);

  const theme = user?.theme || localTheme;
  // Einstellung: 'de' | 'en' | 'auto'; angezeigt wird immer eine konkrete Sprache.
  const langPref = user?.locale || localLang;
  const lang = resolveLang(langPref);
  useEffect(() => {
    applyTheme(theme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = () => applyTheme(theme);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [theme]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const setTheme = async (t) => {
    localStorage.setItem('theme', t);
    setLocalTheme(t);
    if (user) {
      setUser({ ...user, theme: t });
      await api.put('/api/profile', { theme: t }).catch(() => {});
    }
  };
  const setLang = async (l) => {
    localStorage.setItem('lang', l);
    setLocalLang(l);
    if (user) {
      setUser({ ...user, locale: l });
      await api.put('/api/profile', { locale: l }).catch(() => {});
    }
  };
  const logout = async () => {
    await api.post('/api/auth/logout').catch(() => {});
    await clearApiCache();
    setUser(null);
    setGroups([]);
  };

  return (
    <AppCtx.Provider value={{ user, setUser, refreshUser, groups, loadGroups, theme, setTheme, lang, langPref, setLang, logout }}>
      {children}
    </AppCtx.Provider>
  );
}

/** Bereiche (persönlich + Gruppen), in denen der Benutzer schreiben darf. */
export function useWritableScopes() {
  const { groups } = useApp();
  return groups.filter((g) => g.role !== 'viewer');
}
