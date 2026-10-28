import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Users, KeyRound, Sparkles, Home as HomeIcon, Plus, Trash2, ShieldCheck, ShieldOff, Ban, CheckCircle2, Terminal } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app.jsx';
import { useT } from '../lib/i18n.js';
import { useApi, Loading, ErrorBox, Modal, Confirm, useToast, Alert, Avatar } from '../components/ui.jsx';
import { formatDate } from '../lib/format.js';

function UsersTab() {
  const t = useT();
  const toast = useToast();
  const { user } = useApp();
  const { data, error, loading, reload } = useApi('/api/admin/users');
  const [form, setForm] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); reload(); } catch (e) { toast(e.message, { type: 'error' }); } };
  if (loading) return <Loading />;
  return (
    <>
      <ErrorBox error={error} />
      <div className="row" style={{ marginBottom: 12 }}><span className="muted">{t('{n} Benutzer', { n: data.items.length })}</span><span className="spacer" /><button className="btn primary small" onClick={() => setForm({ email: '', display_name: '', password: '', role: 'user' })}><Plus size={16} />{t('Benutzer anlegen')}</button></div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>{t('Benutzer')}</th><th>{t('Anmeldung')}</th><th>{t('Rezepte')}</th><th>{t('Letzte Anmeldung')}</th><th /></tr></thead>
          <tbody>
            {data.items.map((u) => (
              <tr key={u.id} style={{ opacity: u.disabled ? 0.5 : 1 }}>
                <td><div className="row"><Avatar user={u} /><div><b>{u.display_name}</b> {u.role === 'admin' && <span className="badge accent">Admin</span>} {u.disabled && <span className="badge red">{t('Deaktiviert')}</span>}<div className="tiny muted">{u.email}</div></div></div></td>
                <td className="small">{[u.has_password && t('Lokal'), u.oidc && 'Authentik'].filter(Boolean).join(' + ')}</td>
                <td>{u.recipe_count}</td>
                <td className="small">{u.last_login_at ? formatDate(u.last_login_at, t.lang) : '–'}</td>
                <td>
                  {u.id !== user.id && (
                    <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                      <button className="btn ghost icon small" title={u.role === 'admin' ? t('Admin-Rechte entziehen') : t('Zum Admin machen')} onClick={() => act(() => api.put(`/api/admin/users/${u.id}`, { role: u.role === 'admin' ? 'user' : 'admin' }))}>{u.role === 'admin' ? <ShieldOff size={16} /> : <ShieldCheck size={16} />}</button>
                      <button className="btn ghost icon small" title={u.disabled ? t('Aktivieren') : t('Deaktivieren')} onClick={() => act(() => api.put(`/api/admin/users/${u.id}`, { disabled: !u.disabled }))}>{u.disabled ? <CheckCircle2 size={16} /> : <Ban size={16} />}</button>
                      <button className="btn ghost icon small" title={t('Passwort setzen')} onClick={() => { const p = prompt(t('Neues Passwort (mind. 8 Zeichen):')); if (p) act(() => api.put(`/api/admin/users/${u.id}`, { password: p }), t('Passwort gesetzt')); }}><KeyRound size={16} /></button>
                      <button className="btn ghost icon small" title={t('Löschen')} onClick={() => setConfirm(u)}><Trash2 size={16} /></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && (
        <Modal title={t('Benutzer anlegen')} onClose={() => setForm(null)} footer={<><button className="btn" onClick={() => setForm(null)}>{t('Abbrechen')}</button><button className="btn primary" onClick={() => act(async () => { await api.post('/api/admin/users', form); setForm(null); }, t('Benutzer angelegt'))}>{t('Anlegen')}</button></>}>
          <div className="field"><label>{t('Name')}</label><input className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></div>
          <div className="field"><label>{t('E-Mail')}</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="field"><label>{t('Passwort')}</label><input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <label className="check"><input type="checkbox" checked={form.role === 'admin'} onChange={(e) => setForm({ ...form, role: e.target.checked ? 'admin' : 'user' })} />{t('Administrator')}</label>
        </Modal>
      )}
      {confirm && <Confirm title={t('Benutzer löschen?')} danger confirmLabel={t('Löschen')} text={t('{n} und alle eigenen Rezepte, Listen und Pläne werden endgültig gelöscht.', { n: confirm.display_name })} onConfirm={() => act(() => api.del(`/api/admin/users/${confirm.id}`))} onClose={() => setConfirm(null)} />}
    </>
  );
}

function SettingsTabs({ tab }) {
  const t = useT();
  const toast = useToast();
  const { data: s, error, loading, reload } = useApi('/api/admin/settings');
  const [aiKey, setAiKey] = useState('');
  const [ccToken, setCcToken] = useState('');
  const [ccTesting, setCcTesting] = useState(false);
  const [ai, setAi] = useState(null);
  const [ha, setHa] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (s) { setAi(s.ai); setHa({ url: s.ha.url, poll_seconds: s.ha.poll_seconds, token: '' }); } }, [s]);
  if (loading || !ai) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const save = async (body, msg) => {
    setBusy(true);
    try { await api.put('/api/admin/settings', body); toast(msg || t('Gespeichert')); reload(); } catch (e) { toast(e.message, { type: 'error' }); } finally { setBusy(false); }
  };

  if (tab === 'auth') return (
    <div className="stack lg">
      <div className="card pad">
        <h3 style={{ marginBottom: 12 }}>{t('Registrierung')}</h3>
        <div className="stack">
          <label className="switch"><input type="checkbox" checked={s.registration_local} onChange={(e) => save({ registration_local: e.target.checked })} />{t('Neue lokale Konten dürfen sich selbst registrieren')}</label>
          <label className="switch"><input type="checkbox" checked={s.registration_oidc} onChange={(e) => save({ registration_oidc: e.target.checked })} />{t('Neue Konten bei der ersten Anmeldung über Authentik automatisch anlegen')}</label>
          <label className="switch"><input type="checkbox" checked={s.oidc_link_by_email} onChange={(e) => save({ oidc_link_by_email: e.target.checked })} />{t('Authentik-Anmeldungen mit bestehenden Konten gleicher E-Mail verknüpfen')}</label>
        </div>
      </div>
      <div className="card pad">
        <h3 style={{ marginBottom: 8 }}>Authentik (OpenID Connect)</h3>
        {s.oidc_configured ? <Alert type="success">{t('Aktiv')}: {s.oidc_issuer}</Alert> : <Alert type="info">{t('Nicht konfiguriert. Setze OIDC_ISSUER, OIDC_CLIENT_ID und OIDC_CLIENT_SECRET in der Docker-Konfiguration.')}</Alert>}
        <p className="small muted mt">{t('Redirect-URI für den Authentik-Provider')}: <code>{s.oidc_redirect}</code></p>
        <p className="small muted">{t('Optional: Mitglieder der Authentik-Gruppe aus OIDC_ADMIN_GROUP werden automatisch Administratoren.')}</p>
      </div>
    </div>
  );

  if (tab === 'ai') {
    const st = s.ai_status;
    const owner = ai.cc_owner;
    const testCc = async () => {
      setCcTesting(true);
      try {
        const r = await api.post('/api/admin/ai/test-cc');
        toast(r.ok ? t('Claude Code antwortet – die Verbindung über dein Abo funktioniert.') : r.error, { type: r.ok ? '' : 'error', duration: 7000 });
        reload();
      } catch (e) { toast(e.message, { type: 'error' }); } finally { setCcTesting(false); }
    };
    return (
      <div className="stack lg">
        <div className="card pad">
          <h3 style={{ marginBottom: 6 }}><Terminal size={18} style={{ verticalAlign: -3 }} /> {t('Claude Code mit meinem Abo')}</h3>
          <p className="small muted" style={{ marginBottom: 14 }}>{t('Die App ruft dafür das offizielle Claude-Code-Programm im Container auf und nutzt dein Pro- oder Max-Abo statt eines API-Schlüssels. Das ist nur für dich gedacht: Der Modus steht ausschließlich der Person zur Verfügung, die das Token hinterlegt hat. Andere Benutzer nutzen – falls eingerichtet – den API-Schlüssel unten.')}</p>
          {ai.cc_has_token && owner && (
            <div className="row wrap" style={{ marginBottom: 12 }}>
              <span className={`badge ${ai.cc_enabled ? 'green' : ''}`}>{ai.cc_enabled ? t('Aktiv') : t('Ausgeschaltet')}</span>
              <span className="small">{t('Abo von {n}', { n: owner.name })}{owner.is_me ? ` (${t('du')})` : ''}</span>
            </div>
          )}
          {ai.cc_has_token && owner?.is_me && (
            <div className="stack" style={{ marginBottom: 14 }}>
              <label className="switch"><input type="checkbox" checked={ai.cc_enabled} onChange={(e) => save({ ai: { cc: { enabled: e.target.checked } } })} />{t('Für meine KI-Anfragen Claude Code mit meinem Abo verwenden')}</label>
              <div className="row wrap">
                <div className="field" style={{ marginBottom: 0, minWidth: 180 }}>
                  <label>{t('Modell')}</label>
                  <select className="input" value={ai.cc_model} onChange={(e) => save({ ai: { cc: { model: e.target.value } } })}>
                    {ai.cc_models.map((m) => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}
                  </select>
                </div>
                <div style={{ alignSelf: 'flex-end' }} className="btn-row">
                  <button className="btn" disabled={ccTesting} onClick={testCc}>{ccTesting ? t('Teste …') : t('Verbindung testen')}</button>
                  <button className="btn danger" onClick={() => save({ ai: { cc: { remove: true } } }, t('Token entfernt'))}>{t('Token entfernen')}</button>
                </div>
              </div>
              <p className="hint">{t('Der Test schickt eine winzige Anfrage („Antworte nur mit OK“) und verbraucht dafür einen sehr kleinen Teil deines Kontingents.')}</p>
            </div>
          )}
          {ai.cc_has_token && owner && !owner.is_me && (
            <div style={{ marginBottom: 12 }}>
              <Alert type="info">{t('Dieses Abo gehört {n} und kann nur von dieser Person genutzt und eingeschaltet werden. Du kannst das Token entfernen oder ein eigenes hinterlegen (es ersetzt das bisherige).', { n: owner.name })}</Alert>
              <button className="btn danger small mt" onClick={() => save({ ai: { cc: { remove: true } } }, t('Token entfernt'))}>{t('Token entfernen')}</button>
            </div>
          )}
          <ol className="small" style={{ paddingLeft: 20, margin: '0 0 12px', lineHeight: 1.7 }}>
            <li>{t('Auf einem Rechner mit Claude Code im Terminal ausführen:')} <code>claude setup-token</code></li>
            <li>{t('Im Browser mit deinem Claude-Konto anmelden. Das Token (beginnt mit sk-ant-oat…) wird im Terminal angezeigt und ist ein Jahr gültig.')}</li>
            <li>{t('Token hier einfügen und speichern.')}</li>
          </ol>
          <div className="row wrap">
            <input className="input" style={{ flex: 1, minWidth: 240 }} type="password" autoComplete="off" placeholder={ai.cc_has_token ? t('Neues Token eingeben, um es zu ersetzen') : 'sk-ant-oat01-…'} value={ccToken} onChange={(e) => setCcToken(e.target.value)} />
            <button className="btn primary" disabled={busy || !ccToken.trim()} onClick={async () => { await save({ ai: { cc: { token: ccToken } } }, t('Token gespeichert – teste jetzt die Verbindung.')); setCcToken(''); }}>{t('Speichern')}</button>
          </div>
          <div className="mt">
            <Alert type="warn">{t('Damit wirklich nur dein Abo-Kontingent genutzt wird: Schalte in den Claude-Einstellungen (claude.ai → Einstellungen → Nutzung) zusätzliche Nutzung bzw. „Usage credits“ aus. Ist dein Sitzungs- oder Wochenlimit erreicht, zeigt die App das an, statt weiterzumachen.')}</Alert>
          </div>
        </div>
        <div className="card pad">
          <h3 style={{ marginBottom: 6 }}><Sparkles size={18} style={{ verticalAlign: -3 }} /> {t('API-Schlüssel (für alle Benutzer)')}</h3>
          <p className="small muted" style={{ marginBottom: 14 }}>{t('Hinterlege einmal einen Zugang. Alle freigegebenen Benutzer nutzen ihn für die Rezepterkennung aus Fotos und Webseiten, ohne ihn zu sehen.')}</p>
          <Alert type="info">
            {t('Ein API-Schlüssel aus der Claude Console (console.anthropic.com) wird nach Nutzung abgerechnet und darf – anders als ein Abo – auch für andere Benutzer dieser App verwendet werden. Über die Limits unten bestimmst du, wie viele Anfragen höchstens möglich sind.')}
          </Alert>
          <div className="mt">
            {ai.has_key ? (
              <div className="row wrap">
                <span className="badge green">{t('Schlüssel hinterlegt')} {ai.key_hint}</span>
                <button className="btn small" onClick={async () => { const r = await api.post('/api/admin/ai/test'); toast(r.ok ? t('Verbindung OK: {m}', { m: r.display_name || r.model }) : r.error, { type: r.ok ? '' : 'error' }); }}>{t('Verbindung testen')}</button>
                <button className="btn small danger" onClick={() => save({ ai: { remove_key: true } }, t('Schlüssel entfernt'))}>{t('Schlüssel entfernen')}</button>
              </div>
            ) : null}
            <div className="row wrap mt">
              <input className="input" style={{ flex: 1, minWidth: 240 }} type="password" placeholder={ai.has_key ? t('Neuen API-Schlüssel eingeben, um ihn zu ersetzen') : 'sk-ant-…'} value={aiKey} onChange={(e) => setAiKey(e.target.value)} autoComplete="off" />
              <button className="btn primary" disabled={busy || !aiKey.trim()} onClick={async () => { await save({ ai: { api_key: aiKey, model: ai.model } }, t('Schlüssel geprüft und gespeichert')); setAiKey(''); }}>{t('Prüfen & speichern')}</button>
            </div>
            <p className="hint mt">{t('Die Prüfung ruft nur die kostenlose Modell-Information ab – es entstehen keine Kosten.')}</p>
          </div>
        </div>
        <div className="card pad">
          <h3 style={{ marginBottom: 12 }}>{t('Freigabe & Limits')}</h3>
          <div className="stack">
            <label className="switch"><input type="checkbox" checked={ai.enabled} onChange={(e) => setAi({ ...ai, enabled: e.target.checked })} />{t('API-Schlüssel aktiviert')}</label>
            <label className="switch"><input type="checkbox" checked={ai.shared} onChange={(e) => setAi({ ...ai, shared: e.target.checked })} />{t('Für alle Benutzer freigeben (sonst nur Administratoren)')}</label>
          </div>
          <div className="grid-3 mt">
            <div className="field"><label>{t('Modell (API-Schlüssel)')}</label>
              <select className="input" value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })}>{ai.models.map((m) => <option key={m}>{m}</option>)}</select>
            </div>
            <div className="field"><label>{t('Max. Anfragen pro Monat (alle)')}</label><input className="input" type="number" min="0" value={ai.monthly_limit} onChange={(e) => setAi({ ...ai, monthly_limit: e.target.value })} /><span className="hint">{t('0 = unbegrenzt')}</span></div>
            <div className="field"><label>{t('Max. Anfragen pro Person und Tag')}</label><input className="input" type="number" min="0" value={ai.per_user_daily_limit} onChange={(e) => setAi({ ...ai, per_user_daily_limit: e.target.value })} /><span className="hint">{t('0 = unbegrenzt')}</span></div>
          </div>
          <p className="hint" style={{ marginBottom: 10 }}>{t('Die Limits gelten für beide Wege (Abo und API-Schlüssel).')}</p>
          <button className="btn primary" disabled={busy} onClick={() => save({ ai: { enabled: ai.enabled, shared: ai.shared, model: ai.model, monthly_limit: ai.monthly_limit, per_user_daily_limit: ai.per_user_daily_limit } })}>{t('Speichern')}</button>
          <p className="hint mt">{t('Anfragen entstehen nur, wenn jemand ausdrücklich „Rezept erkennen“ oder „Mit KI auslesen“ wählt. Es gibt keine automatischen Wiederholungen oder Hintergrundanfragen.')}</p>
        </div>
        <div className="card pad">
          <h3 style={{ marginBottom: 12 }}>{t('Nutzung in diesem Monat')}</h3>
          <div className="grid-3">
            <div className="card pad center"><h2>{st.used_month}{st.monthly_limit ? ` / ${st.monthly_limit}` : ''}</h2><span className="small muted">{t('Anfragen')}</span></div>
            <div className="card pad center"><h2>{(st.tokens_in_month || 0).toLocaleString()}</h2><span className="small muted">{t('Eingabe-Tokens')}</span></div>
            <div className="card pad center"><h2>{(st.tokens_out_month || 0).toLocaleString()}</h2><span className="small muted">{t('Ausgabe-Tokens')}</span></div>
          </div>
          {!st.available && st.reason && <div className="mt"><Alert type="warn">{t('Status')}: {st.reason}</Alert></div>}
        </div>
      </div>
    );
  }

  if (tab === 'ha') return (
    <div className="stack lg">
      <div className="card pad">
        <h3 style={{ marginBottom: 6 }}><HomeIcon size={18} style={{ verticalAlign: -3 }} /> Home Assistant</h3>
        <p className="small muted" style={{ marginBottom: 14 }}>{t('Verbinde Home Assistant, um Einkaufslisten mit To-do-Listen (todo.*) abzugleichen. Die Verknüpfung selbst erfolgt in der jeweiligen Einkaufsliste.')}</p>
        <div className="field"><label>{t('Adresse')}</label><input className="input" placeholder="http://homeassistant.local:8123" value={ha.url} onChange={(e) => setHa({ ...ha, url: e.target.value })} /></div>
        <div className="field"><label>{t('Langlebiges Zugriffstoken')}</label><input className="input" type="password" placeholder={s.ha.has_token ? t('Gespeichert – zum Ersetzen neu eingeben') : ''} value={ha.token} onChange={(e) => setHa({ ...ha, token: e.target.value })} />
          <span className="hint">{t('Home Assistant → Profil → Sicherheit → Langlebige Zugriffstoken')}</span></div>
        <div className="field" style={{ maxWidth: 220 }}><label>{t('Abgleich alle … Sekunden')}</label><input className="input" type="number" min="10" value={ha.poll_seconds} onChange={(e) => setHa({ ...ha, poll_seconds: e.target.value })} /></div>
        <div className="btn-row">
          <button className="btn primary" disabled={busy} onClick={() => save({ ha: { url: ha.url, token: ha.token || undefined, poll_seconds: ha.poll_seconds } }, t('Verbindung geprüft und gespeichert'))}>{t('Prüfen & speichern')}</button>
          {s.ha.has_token && <button className="btn danger" onClick={() => save({ ha: { remove: true } }, t('Verbindung entfernt'))}>{t('Verbindung entfernen')}</button>}
        </div>
      </div>
      <div className="card pad">
        <h3 style={{ marginBottom: 6 }}>Cookidoo</h3>
        <p className="small muted">{t('Vorwerk bietet keine offizielle Schnittstelle für Cookidoo an. Die Einkaufsliste lässt sich aber über die offizielle Cookidoo-Integration von Home Assistant abgleichen: Integration in Home Assistant einrichten und in der Einkaufsliste die Liste todo.cookidoo_… verknüpfen. Das direkte Übertragen von Rezepten auf den Thermomix ist ohne offizielle Schnittstelle nicht möglich.')}</p>
      </div>
    </div>
  );
  return null;
}

export default function Admin() {
  const t = useT();
  const { user } = useApp();
  const [tab, setTab] = useState('users');
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  const tabs = [['users', Users, 'Benutzer'], ['auth', KeyRound, 'Anmeldung'], ['ai', Sparkles, 'KI-Verbindung'], ['ha', HomeIcon, 'Home Assistant']];
  return (
    <div className="page">
      <div className="page-head"><h1>{t('Administration')}</h1></div>
      <div className="tabs">{tabs.map(([k, I, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}><I size={17} />{t(l)}</button>)}</div>
      {tab === 'users' ? <UsersTab /> : <SettingsTabs tab={tab} />}
    </div>
  );
}
