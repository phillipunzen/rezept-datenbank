import { useEffect, useState } from 'react';
import { Navigate, useSearchParams, Link } from 'react-router-dom';
import { KeyRound, Globe } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app.jsx';
import { useT } from '../lib/i18n.js';
import { Alert } from '../components/ui.jsx';

export default function Login() {
  const t = useT();
  const { user, setUser, loadGroups, lang, setLang } = useApp();
  const [params] = useSearchParams();
  const [cfg, setCfg] = useState(null);
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ login: '', email: '', password: '', display_name: '' });
  const [error, setError] = useState(params.get('error') || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/api/auth/config').then((c) => { setCfg(c); if (c.first_user) setMode('register'); }).catch(() => setCfg({}));
  }, []);

  const next = params.get('next') || '/';
  if (user) return <Navigate to={next} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = mode === 'login'
        ? await api.post('/api/auth/login', { login: form.login, password: form.password })
        : await api.post('/api/auth/register', { email: form.email, password: form.password, display_name: form.display_name, locale: localStorage.getItem('lang') || 'auto' });
      setUser(d.user);
      loadGroups();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="auth-wrap">
      <div className="auth-art">
        <div className="brand" style={{ padding: 0, color: '#fff' }}><img src="/icon.svg" alt="" style={{ width: 40, height: 40, borderRadius: 10 }} />{t('Rezeptbuch')}</div>
        <div>
          <h1>{t('Gemeinsam kochen beginnt mit einem guten Rezeptbuch.')}</h1>
          <p>{t('Sammle Rezepte, plane die Woche, kauf gemeinsam ein und koche Schritt für Schritt.')}</p>
        </div>
        <div className="row" style={{ gap: 16, position: 'relative', zIndex: 1 }}>
          <Link to="/p" style={{ color: '#fff', opacity: .9 }}><Globe size={16} style={{ verticalAlign: -3 }} /> {t('Öffentliche Rezepte entdecken')}</Link>
          <button className="btn small" style={{ background: 'rgba(255,255,255,.15)', color: '#fff', borderColor: 'transparent' }} onClick={() => setLang(lang === 'de' ? 'en' : 'de')}>
            {lang === 'de' ? 'English' : 'Deutsch'}
          </button>
        </div>
        <div className="deco" />
      </div>
      <div className="auth-form">
        <div className="card">
          <h2 style={{ marginBottom: 6 }}>{mode === 'login' ? t('Anmelden') : cfg?.first_user ? t('Administrator anlegen') : t('Konto erstellen')}</h2>
          <p className="muted small" style={{ marginBottom: 20 }}>
            {cfg?.first_user ? t('Das erste Konto erhält Administratorrechte.') : mode === 'login' ? t('Willkommen zurück!') : t('Erstelle ein lokales Konto.')}
          </p>
          {error && <div style={{ marginBottom: 14 }}><Alert type="error">{error}</Alert></div>}
          {cfg?.oidc && !cfg.first_user && (
            <>
              <a className="btn block large oidc-btn" href="/api/auth/oidc/start">
                {/authentik/i.test(cfg.oidc.name) ? <img src="/brands/authentik.svg" alt="" width={24} height={24} /> : <KeyRound size={20} />}
                {t('Mit {name} anmelden', { name: cfg.oidc.name })}
              </a>
              {cfg.oidc.registration && <p className="hint center" style={{ marginTop: 8 }}>{t('Neue Konten werden dabei automatisch angelegt.')}</p>}
              <div className="or">{t('oder')}</div>
            </>
          )}
          <form onSubmit={submit}>
            {mode === 'login' ? (
              <div className="field"><label>{t('E-Mail oder Benutzername')}</label><input className="input" autoComplete="username" value={form.login} onChange={set('login')} required autoFocus /></div>
            ) : (
              <>
                <div className="field"><label>{t('Name')}</label><input className="input" value={form.display_name} onChange={set('display_name')} required autoFocus /></div>
                <div className="field"><label>{t('E-Mail')}</label><input className="input" type="email" autoComplete="email" value={form.email} onChange={set('email')} required /></div>
              </>
            )}
            <div className="field">
              <label>{t('Passwort')}</label>
              <input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={set('password')} required minLength={mode === 'login' ? 1 : 8} />
              {mode !== 'login' && <span className="hint">{t('Mindestens 8 Zeichen')}</span>}
            </div>
            <button className="btn primary block large" disabled={busy}>{mode === 'login' ? t('Anmelden') : t('Konto erstellen')}</button>
          </form>
          {cfg && !cfg.first_user && cfg.registration && (
            <p className="center small mt">
              {mode === 'login'
                ? <>{t('Noch kein Konto?')} <span className="link" onClick={() => setMode('register')}>{t('Registrieren')}</span></>
                : <>{t('Schon registriert?')} <span className="link" onClick={() => setMode('login')}>{t('Anmelden')}</span></>}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
