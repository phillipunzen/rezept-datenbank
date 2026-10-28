import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sun, Moon, Monitor, Camera, KeyRound, LogOut, CloudOff, Trash2 } from 'lucide-react';
import { api, cacheRecipeOffline, clearApiCache } from '../lib/api.js';
import { useApp } from '../lib/app.jsx';
import { useT } from '../lib/i18n.js';
import { useApi, Avatar, useToast, Alert } from '../components/ui.jsx';

export default function SettingsPage() {
  const t = useT();
  const toast = useToast();
  const [params] = useSearchParams();
  const { user, setUser, theme, setTheme, langPref, setLang, logout } = useApp();
  const [profile, setProfile] = useState({ display_name: user.display_name, email: user.email || '', username: user.username || '' });
  const [pw, setPw] = useState({ current: '', password: '' });
  const avatarInput = useRef();
  const authCfg = useApi('/api/auth/config');
  const offline = useApi('/api/offline-recipes');
  const [syncing, setSyncing] = useState(false);
  const [install, setInstall] = useState(null);

  useEffect(() => {
    const fn = (e) => { e.preventDefault(); setInstall(e); };
    window.addEventListener('beforeinstallprompt', fn);
    return () => window.removeEventListener('beforeinstallprompt', fn);
  }, []);

  const saveProfile = async (e) => {
    e.preventDefault();
    try { const d = await api.put('/api/profile', profile); setUser(d.user); toast(t('Profil gespeichert')); } catch (err) { toast(err.message, { type: 'error' }); }
  };
  const savePw = async (e) => {
    e.preventDefault();
    try { await api.put('/api/profile/password', pw); setPw({ current: '', password: '' }); toast(t('Passwort geändert')); } catch (err) { toast(err.message, { type: 'error' }); }
  };
  const uploadAvatar = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try { const d = await api.upload('/api/profile/avatar', fd); setUser(d.user); } catch (err) { toast(err.message, { type: 'error' }); }
  };
  const syncOffline = async () => {
    setSyncing(true);
    try {
      for (const id of offline.data?.ids || []) await cacheRecipeOffline(id);
      toast(t('{n} Rezepte offline gespeichert', { n: offline.data?.ids.length || 0 }));
    } finally { setSyncing(false); }
  };

  const themes = [['system', Monitor, 'System'], ['light', Sun, 'Hell'], ['dark', Moon, 'Dunkel']];
  return (
    <div className="page narrow">
      <div className="page-head"><h1>{t('Einstellungen')}</h1></div>
      {params.get('linked') && <Alert type="success">{t('Dein Konto ist jetzt mit Authentik verknüpft.')}</Alert>}
      {params.get('error') && <Alert type="error">{params.get('error')}</Alert>}

      <div className="card pad mt">
        <h3 style={{ marginBottom: 14 }}>{t('Profil')}</h3>
        <div className="row" style={{ gap: 18, marginBottom: 18 }}>
          <Avatar user={user} size="lg" />
          <div className="btn-row">
            <button className="btn small" onClick={() => avatarInput.current.click()}><Camera size={16} />{t('Profilbild ändern')}</button>
            {user.avatar && <button className="btn small ghost" onClick={async () => { const d = await api.del('/api/profile/avatar'); setUser(d.user); }}>{t('Entfernen')}</button>}
          </div>
          <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(e) => uploadAvatar(e.target.files[0])} />
        </div>
        <form onSubmit={saveProfile}>
          <div className="grid-2">
            <div className="field"><label>{t('Name')}</label><input className="input" value={profile.display_name} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} /></div>
            <div className="field"><label>{t('Benutzername')}</label><input className="input" value={profile.username} onChange={(e) => setProfile({ ...profile, username: e.target.value })} /></div>
          </div>
          <div className="field"><label>{t('E-Mail')}</label><input className="input" type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></div>
          <button className="btn primary">{t('Speichern')}</button>
        </form>
      </div>

      <div className="card pad mt">
        <h3 style={{ marginBottom: 14 }}>{t('Erscheinungsbild & Sprache')}</h3>
        <div className="field"><label>{t('Design')}</label>
          <div className="segmented">{themes.map(([k, I, l]) => <button key={k} className={theme === k ? 'active' : ''} onClick={() => setTheme(k)}><I size={15} style={{ verticalAlign: -3 }} /> {t(l)}</button>)}</div>
          <span className="hint">{t('„System“ folgt automatisch der Einstellung deines Geräts.')}</span>
        </div>
        <div className="field"><label>{t('Sprache')}</label>
          <div className="segmented">
            <button className={langPref !== 'de' && langPref !== 'en' ? 'active' : ''} onClick={() => setLang('auto')}>{t('Automatisch')}</button>
            <button className={langPref === 'de' ? 'active' : ''} onClick={() => setLang('de')}>Deutsch</button>
            <button className={langPref === 'en' ? 'active' : ''} onClick={() => setLang('en')}>English</button>
          </div>
          <span className="hint">{t('„Automatisch“ richtet sich nach den bevorzugten Sprachen deines Browsers.')}</span>
        </div>
      </div>

      <div className="card pad mt">
        <h3 style={{ marginBottom: 6 }}><CloudOff size={18} style={{ verticalAlign: -3 }} /> {t('Offline & App')}</h3>
        <p className="small muted" style={{ marginBottom: 12 }}>{t('Der aktuelle Wochenplan, deine Einkaufslisten und zuletzt geöffnete Rezepte werden automatisch auf diesem Gerät gespeichert. Zusätzlich kannst du einzelne Rezepte über das Menü „Offline verfügbar machen“ dauerhaft vorhalten.')}</p>
        <div className="btn-row">
          <button className="btn" disabled={syncing} onClick={syncOffline}>{t('{n} Offline-Rezepte aktualisieren', { n: offline.data?.ids.length || 0 })}</button>
          <button className="btn ghost" onClick={async () => { await clearApiCache(); toast(t('Offline-Daten gelöscht')); }}><Trash2 size={16} />{t('Offline-Daten löschen')}</button>
          {install && <button className="btn primary" onClick={() => { install.prompt(); setInstall(null); }}>{t('App installieren')}</button>}
        </div>
        {!install && <p className="hint mt">{t('Installieren: Im Browser-Menü „Zum Startbildschirm hinzufügen“ bzw. „App installieren“ wählen.')}</p>}
      </div>

      <div className="card pad mt">
        <h3 style={{ marginBottom: 14 }}><KeyRound size={18} style={{ verticalAlign: -3 }} /> {t('Anmeldung')}</h3>
        {authCfg.data?.oidc && (
          <div className="row" style={{ marginBottom: 16 }}>
            {/authentik/i.test(authCfg.data.oidc.name) && <img src="/brands/authentik.svg" alt="" width={22} height={22} />}
            <span style={{ flex: 1 }}>{authCfg.data.oidc.name}: {user.oidc ? <span className="badge green">{t('Verknüpft')}</span> : <span className="badge">{t('Nicht verknüpft')}</span>}</span>
            {!user.oidc && <a className="btn small" href="/api/auth/oidc/start?link=1">{t('Jetzt verknüpfen')}</a>}
          </div>
        )}
        <form onSubmit={savePw}>
          {user.has_password && <div className="field"><label>{t('Aktuelles Passwort')}</label><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></div>}
          <div className="field"><label>{user.has_password ? t('Neues Passwort') : t('Lokales Passwort festlegen')}</label><input className="input" type="password" autoComplete="new-password" minLength={8} value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></div>
          <button className="btn" disabled={pw.password.length < 8}>{t('Passwort ändern')}</button>
        </form>
        <div className="divider" />
        <div className="btn-row">
          <button className="btn" onClick={logout}><LogOut size={16} />{t('Abmelden')}</button>
          <button className="btn ghost" onClick={async () => { await api.post('/api/auth/logout-all'); logout(); }}>{t('Auf allen Geräten abmelden')}</button>
        </div>
      </div>
    </div>
  );
}
