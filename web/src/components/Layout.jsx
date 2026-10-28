import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, Link } from 'react-router-dom';
import {
  Home, BookOpen, CalendarDays, ShoppingCart, Plus, Library, Users, Settings, Shield, Trash2, Globe,
  Archive, Menu as MenuIcon, LogOut, WifiOff, Sun, Moon, Monitor,
} from 'lucide-react';
import { useApp } from '../lib/app.jsx';
import { useT } from '../lib/i18n.js';
import { onNetworkChange, isOffline, queuedCount } from '../lib/api.js';
import { Avatar, Modal } from './ui.jsx';

export default function Layout() {
  const t = useT();
  const { user, logout, theme, setTheme } = useApp();
  const [offline, setOffline] = useState(isOffline());
  const [queued, setQueued] = useState(0);
  const [more, setMore] = useState(false);
  const loc = useLocation();

  useEffect(() => onNetworkChange(setOffline), []);
  useEffect(() => {
    const upd = () => queuedCount().then(setQueued);
    upd();
    window.addEventListener('rb:queue-flushed', upd);
    const id = setInterval(upd, 5000);
    return () => { window.removeEventListener('rb:queue-flushed', upd); clearInterval(id); };
  }, []);
  useEffect(() => { setMore(false); window.scrollTo(0, 0); }, [loc.pathname]);

  const main = [
    { to: '/', icon: Home, label: t('Start'), end: true },
    { to: '/recipes', icon: BookOpen, label: t('Rezepte') },
    { to: '/plan', icon: CalendarDays, label: t('Wochenplan') },
    { to: '/shopping', icon: ShoppingCart, label: t('Einkauf') },
  ];
  const secondary = [
    { to: '/cookbooks', icon: Library, label: t('Rezeptbücher') },
    { to: '/pantry', icon: Archive, label: t('Vorratsschrank') },
    { to: '/groups', icon: Users, label: t('Gruppen') },
    { to: '/discover', icon: Globe, label: t('Öffentliche Rezepte') },
    { to: '/trash', icon: Trash2, label: t('Papierkorb') },
  ];
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const nextTheme = { system: 'light', light: 'dark', dark: 'system' }[theme] || 'system';

  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/" className="brand"><img src="/icon.svg" alt="" />{t('Rezeptbuch')}</Link>
        <Link to="/import" className="btn primary" style={{ marginBottom: 14 }}><Plus size={18} />{t('Rezept hinzufügen')}</Link>
        {main.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className="nav-item"><n.icon size={20} />{n.label}</NavLink>)}
        <div className="nav-section">{t('Mehr')}</div>
        {secondary.map((n) => <NavLink key={n.to} to={n.to} className="nav-item"><n.icon size={20} />{n.label}</NavLink>)}
        <div className="sidebar-footer">
          {user?.role === 'admin' && <NavLink to="/admin" className="nav-item"><Shield size={20} />{t('Administration')}</NavLink>}
          <NavLink to="/settings" className="nav-item"><Avatar user={user} />{user?.display_name}</NavLink>
          <div className="row" style={{ padding: '0 4px' }}>
            <button className="btn ghost small" onClick={() => setTheme(nextTheme)} title={t('Erscheinungsbild')}><ThemeIcon size={17} />{t({ system: 'System', light: 'Hell', dark: 'Dunkel' }[theme])}</button>
            <span className="spacer" />
            <button className="btn ghost icon small" onClick={logout} title={t('Abmelden')}><LogOut size={17} /></button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar no-print">
          <Link to="/" className="brand"><img src="/icon.svg" alt="" />{t('Rezeptbuch')}</Link>
          <div className="row" style={{ gap: 6 }}>
            <Link to="/import" className="btn primary icon small" aria-label={t('Rezept hinzufügen')}><Plus size={20} /></Link>
            <Link to="/settings" aria-label={t('Einstellungen')}><Avatar user={user} /></Link>
          </div>
        </header>
        {(offline || queued > 0) && (
          <div className="offline-bar no-print">
            <WifiOff size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
            {offline ? t('Offline – du siehst gespeicherte Daten.') : ''}
            {queued > 0 ? ` ${t('{n} Änderungen werden übertragen, sobald du online bist.', { n: queued })}` : ''}
          </div>
        )}
        <Outlet />
      </div>

      <nav className="bottomnav no-print">
        {main.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}><n.icon size={22} />{n.label}</NavLink>
        ))}
        <button onClick={() => setMore(true)} className={more ? 'active' : ''}><MenuIcon size={22} />{t('Mehr')}</button>
      </nav>
      {more && (
        <Modal title={t('Mehr')} onClose={() => setMore(false)}>
          <div className="stack" style={{ gap: 2 }}>
            {secondary.map((n) => <NavLink key={n.to} to={n.to} className="nav-item"><n.icon size={20} />{n.label}</NavLink>)}
            <NavLink to="/settings" className="nav-item"><Settings size={20} />{t('Einstellungen')}</NavLink>
            {user?.role === 'admin' && <NavLink to="/admin" className="nav-item"><Shield size={20} />{t('Administration')}</NavLink>}
            <button className="nav-item" style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => setTheme(nextTheme)}>
              <ThemeIcon size={20} />{t('Erscheinungsbild')}: {t({ system: 'System', light: 'Hell', dark: 'Dunkel' }[theme])}
            </button>
            <button className="nav-item" style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={logout}><LogOut size={20} />{t('Abmelden')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
