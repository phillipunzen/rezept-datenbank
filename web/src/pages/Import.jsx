import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  PenLine, Link2, Camera, Database, FileUp, ChevronLeft, Sparkles, CheckCircle2, XCircle, SkipForward, Loader2, Upload, X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app.jsx';
import { useT } from '../lib/i18n.js';
import { Alert, Loading, useToast, useApi } from '../components/ui.jsx';
import { RecipeForm } from './RecipeEditor.jsx';

function AiNotice({ status }) {
  const t = useT();
  if (!status) return null;
  if (status.available) {
    if (status.provider === 'claude_code') {
      return <p className="hint">{t('Nutzt Claude Code mit deinem Claude-Abo. Heute genutzt: {d}{dl}', { d: status.used_today, dl: status.per_user_daily_limit ? ` / ${status.per_user_daily_limit}` : '' })}</p>;
    }
    return <p className="hint">{t('Nutzt die zentrale Claude-Verbindung. Heute genutzt: {d}{dl} · Monat: {m}{ml}', {
      d: status.used_today, dl: status.per_user_daily_limit ? ` / ${status.per_user_daily_limit}` : '',
      m: status.used_month, ml: status.monthly_limit ? ` / ${status.monthly_limit}` : '',
    })}</p>;
  }
  const text = {
    not_configured: t('Die KI-Erkennung ist noch nicht eingerichtet. Ein Administrator kann sie unter Administration → KI-Verbindung aktivieren.'),
    disabled: t('Die KI-Funktionen sind derzeit deaktiviert.'),
    not_shared: t('Die KI-Verbindung ist nur für Administratoren freigegeben.'),
    monthly_limit: t('Das monatliche KI-Kontingent ist aufgebraucht. Es wird zu Monatsbeginn zurückgesetzt.'),
    daily_limit: t('Dein tägliches KI-Kontingent ist erreicht. Morgen geht es weiter.'),
    cc_owner_only: t('Das verbundene Claude-Abo ist einem anderen Konto zugeordnet. Ein Administrator kann unter Administration → KI-Verbindung festlegen, zu welchem Konto es gehört.'),
  }[status.reason];
  return <Alert type="warn">{text}</Alert>;
}

function UrlImport({ onDraft }) {
  const t = useT();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fallback, setFallback] = useState(null);
  const ai = useApi('/api/ai/status');
  const go = async (useAi) => {
    setBusy(true);
    setError('');
    try {
      const d = await api.post(useAi ? '/api/import/url/ai' : '/api/import/url', { url });
      if (!d.found) setFallback(d);
      else onDraft(d.draft, d.warnings);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="card pad">
      <h2 style={{ marginBottom: 6 }}>{t('Von einer Website importieren')}</h2>
      <p className="muted small" style={{ marginBottom: 16 }}>{t('Füge den Link zu einem Rezept ein. Zutaten, Schritte, Zeiten und das Bild werden übernommen.')}</p>
      <form className="row wrap" onSubmit={(e) => { e.preventDefault(); go(false); }}>
        <input className="input" style={{ flex: 1, minWidth: 240 }} type="url" required placeholder="https://www.chefkoch.de/rezepte/…" value={url} onChange={(e) => { setUrl(e.target.value); setFallback(null); }} autoFocus />
        <button className="btn primary" disabled={busy}>{busy ? <Loader2 size={18} className="spin" /> : <Link2 size={18} />}{t('Importieren')}</button>
      </form>
      {busy && <p className="hint mt">{t('Seite wird geladen und ausgewertet …')}</p>}
      {error && <div className="mt"><Alert type="error">{error}</Alert></div>}
      {fallback && (
        <div className="mt stack">
          <Alert type="warn">{t('Auf dieser Seite wurden keine strukturierten Rezeptdaten gefunden.')}</Alert>
          {fallback.ai_available ? (
            <div className="row wrap">
              <button className="btn" disabled={busy} onClick={() => go(true)}><Sparkles size={18} />{t('Mit KI auslesen')}</button>
              <AiNotice status={ai.data} />
            </div>
          ) : <AiNotice status={ai.data} />}
        </div>
      )}
    </div>
  );
}

function PhotoImport({ onDraft }) {
  const t = useT();
  const toast = useToast();
  const ai = useApi('/api/ai/status');
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [keepPhoto, setKeepPhoto] = useState(false);
  const input = useRef();
  const camera = useRef();
  const upload = async (files) => {
    if (!files?.length) return;
    setBusy('upload');
    try {
      const fd = new FormData();
      [...files].forEach((f) => fd.append('files', f));
      const d = await api.upload('/api/uploads/image', fd);
      setPhotos((p) => [...p, ...d.images]);
    } catch (e) { toast(e.message, { type: 'error' }); } finally { setBusy(''); }
  };
  const recognize = async () => {
    setBusy('ai');
    setError('');
    try {
      const d = await api.post('/api/import/photo', { images: photos.map((p) => p.path) });
      onDraft({ ...d.draft, images: keepPhoto ? photos.map((p) => p.path) : [] }, d.warnings);
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  return (
    <div className="card pad">
      <h2 style={{ marginBottom: 6 }}>{t('Foto eines Rezepts')}</h2>
      <p className="muted small" style={{ marginBottom: 16 }}>{t('Gedruckt oder handschriftlich – auch mehrere Seiten. Unsichere Stellen werden markiert, damit du sie prüfen kannst.')}</p>
      <AiNotice status={ai.data} />
      <div className="image-strip mt">
        {photos.map((p) => (
          <div className="image-tile" key={p.path} style={{ width: 140, height: 110 }}>
            <img src={p.url.replace('.webp', '.thumb.webp')} alt="" />
            <div className="tile-actions"><button onClick={() => setPhotos(photos.filter((x) => x !== p))}><X size={14} /></button></div>
          </div>
        ))}
        <div className="dropzone" style={{ width: 140, height: 110, padding: 8 }} onClick={() => camera.current.click()}>
          <Camera size={24} /><span className="tiny">{t('Foto aufnehmen')}</span>
        </div>
        <div className="dropzone" style={{ width: 140, height: 110, padding: 8 }} onClick={() => input.current.click()}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
          {busy === 'upload' ? <div className="spinner" /> : <><Upload size={24} /><span className="tiny">{t('Bilder auswählen')}</span></>}
        </div>
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
      {photos.length > 0 && (
        <div className="mt stack">
          <label className="check small"><input type="checkbox" checked={keepPhoto} onChange={(e) => setKeepPhoto(e.target.checked)} />{t('Foto auch als Rezeptbild verwenden')}</label>
          <div><button className="btn primary" disabled={!!busy || !ai.data?.available} onClick={recognize}>
            {busy === 'ai' ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}{busy === 'ai' ? t('Rezept wird erkannt …') : t('Rezept erkennen')}
          </button></div>
          {busy === 'ai' && <p className="hint">{t('Das kann bei Handschrift bis zu einer Minute dauern.')}</p>}
        </div>
      )}
      {error && <div className="mt"><Alert type="error">{error}</Alert></div>}
    </div>
  );
}

function BulkTarget({ value, onChange }) {
  const t = useT();
  const { groups } = useApp();
  const books = useApi('/api/cookbooks');
  return (
    <div className="grid-2">
      <div className="field"><label>{t('Speichern in')}</label>
        <select className="input" value={value.group_id || ''} onChange={(e) => onChange({ ...value, group_id: e.target.value || null })}>
          <option value="">{t('Privat')}</option>
          {groups.filter((g) => g.role !== 'viewer').map((g) => <option key={g.id} value={g.id}>{t('Gemeinsam')}: {g.name}</option>)}
        </select>
      </div>
      <div className="field"><label>{t('Zusätzlich in Rezeptbuch')}</label>
        <select className="input" value={value.cookbook_id || ''} onChange={(e) => onChange({ ...value, cookbook_id: e.target.value || null })}>
          <option value="">–</option>
          {books.data?.items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
    </div>
  );
}

function SelectList({ items, selected, setSelected, render }) {
  const t = useT();
  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="small muted">{t('{a} von {b} ausgewählt', { a: selected.size, b: items.length })}</span>
        <span className="spacer" />
        <span className="link small" onClick={() => setSelected(new Set(items.map((i) => i.key)))}>{t('Alle')}</span>
        <span className="link small" onClick={() => setSelected(new Set(items.filter((i) => !i.duplicate).map((i) => i.key)))}>{t('Ohne Duplikate')}</span>
        <span className="link small" onClick={() => setSelected(new Set())}>{t('Keine')}</span>
      </div>
      <div className="select-list">
        {items.map((i) => (
          <label key={i.key}>
            <input type="checkbox" checked={selected.has(i.key)} onChange={(e) => {
              const n = new Set(selected);
              if (e.target.checked) n.add(i.key); else n.delete(i.key);
              setSelected(n);
            }} />
            {render(i)}
          </label>
        ))}
      </div>
    </>
  );
}

function TandoorImport() {
  const t = useT();
  const navigate = useNavigate();
  const [cfg, setCfg] = useState({ url: localStorage.getItem('tandoor_url') || '', token: '' });
  const [list, setList] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [target, setTarget] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      localStorage.setItem('tandoor_url', cfg.url);
      const d = await api.post('/api/import/tandoor/list', cfg);
      setList(d.items);
      setSelected(new Set(d.items.filter((i) => !i.duplicate).map((i) => i.id)));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const run = async () => {
    setBusy(true);
    try {
      const d = await api.post('/api/import/tandoor/run', { ...cfg, ids: [...selected], ...target });
      navigate(`/import/jobs/${d.job_id}`);
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <div className="card pad">
      <h2 style={{ marginBottom: 6 }}>{t('Aus Tandoor importieren')}</h2>
      <p className="muted small" style={{ marginBottom: 16 }}>{t('Verbinde deine Tandoor-Instanz mit einem API-Token (Tandoor → Einstellungen → API). Der Token wird nicht gespeichert.')}</p>
      <form onSubmit={load} className="grid-2">
        <div className="field"><label>{t('Tandoor-Adresse')}</label><input className="input" type="url" required placeholder="https://tandoor.example.org" value={cfg.url} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} /></div>
        <div className="field"><label>{t('API-Token')}</label><input className="input" type="password" required value={cfg.token} onChange={(e) => setCfg({ ...cfg, token: e.target.value })} /></div>
        <div><button className="btn" disabled={busy}><Database size={18} />{t('Rezepte laden')}</button></div>
      </form>
      {error && <div className="mt"><Alert type="error">{error}</Alert></div>}
      {list && (
        <div className="mt-lg">
          <h3 style={{ marginBottom: 10 }}>{t('Vorschau: {n} Rezepte gefunden', { n: list.length })}</h3>
          <SelectList items={list.map((i) => ({ ...i, key: i.id }))} selected={selected} setSelected={setSelected} render={(i) => (
            <>
              {i.image ? <img src={i.image} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : <div className="noimg" />}
              <span style={{ flex: 1 }}>{i.name}</span>
              {i.duplicate && <span className="badge yellow">{t('Bereits vorhanden?')}</span>}
            </>
          )} />
          <div className="mt"><BulkTarget value={target} onChange={setTarget} /></div>
          <button className="btn primary" disabled={busy || !selected.size} onClick={run}>{t('{n} Rezepte importieren', { n: selected.size })}</button>
        </div>
      )}
    </div>
  );
}

function FileImport({ onDraft }) {
  const t = useT();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [target, setTarget] = useState({});
  const input = useRef();
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const d = await api.upload('/api/import/file', fd);
      if (d.drafts.length === 1) onDraft(d.drafts[0], d.errors);
      else {
        setResult(d);
        setSelected(new Set(d.drafts.map((x, i) => (x._duplicate ? null : i)).filter((x) => x != null)));
      }
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const run = async () => {
    setBusy(true);
    try {
      const drafts = result.drafts.filter((_, i) => selected.has(i));
      const d = await api.post('/api/import/bulk', { drafts, ...target });
      navigate(`/import/jobs/${d.job_id}`);
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <div className="card pad">
      <h2 style={{ marginBottom: 6 }}>{t('Rezeptdateien importieren')}</h2>
      <p className="muted small" style={{ marginBottom: 16 }}>{t('Unterstützt: Rezeptbuch-Export (.json), schema.org-Rezepte (JSON-LD) und Tandoor-Exporte (.zip).')}</p>
      <div className="dropzone" onClick={() => input.current.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files[0]); }}>
        {busy ? <div className="spinner" /> : <><FileUp size={30} /><b>{t('Datei auswählen oder hierher ziehen')}</b><span className="tiny">.json, .zip</span></>}
      </div>
      <input ref={input} type="file" accept=".json,.zip,application/json,application/zip" hidden onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
      {error && <div className="mt"><Alert type="error">{error}</Alert></div>}
      {result && (
        <div className="mt-lg">
          <h3 style={{ marginBottom: 10 }}>{t('Vorschau: {n} Rezepte gefunden', { n: result.drafts.length })}</h3>
          {result.errors.length > 0 && <div style={{ marginBottom: 10 }}><Alert type="warn">{result.errors.slice(0, 5).join(' · ')}</Alert></div>}
          <SelectList items={result.drafts.map((d, i) => ({ ...d, key: i, duplicate: d._duplicate }))} selected={selected} setSelected={setSelected} render={(d) => (
            <>
              {d.images?.[0] ? <img src={`/uploads/${d.images[0].replace('.webp', '.thumb.webp')}`} alt="" /> : <div className="noimg" />}
              <span style={{ flex: 1 }}>{d.title}<br /><span className="tiny faint">{t('{a} Zutaten · {b} Schritte', { a: (d.ingredients || []).reduce((n, g) => n + (g.items?.length || 0), 0), b: (d.steps || []).length })}</span></span>
              {d.duplicate && <span className="badge yellow">{t('Bereits vorhanden?')}</span>}
            </>
          )} />
          <div className="mt"><BulkTarget value={target} onChange={setTarget} /></div>
          <button className="btn primary" disabled={busy || !selected.size} onClick={run}>{t('{n} Rezepte importieren', { n: selected.size })}</button>
        </div>
      )}
      <div className="divider" />
      <h3 style={{ marginBottom: 6 }}>{t('Exportieren')}</h3>
      <p className="muted small" style={{ marginBottom: 10 }}>{t('Alle für dich sichtbaren Rezepte inklusive Titelbild als Datei sichern.')}</p>
      <a className="btn" href="/api/export">{t('Alle Rezepte exportieren')}</a>
    </div>
  );
}

function JobView({ jobId }) {
  const t = useT();
  const [job, setJob] = useState(null);
  useEffect(() => {
    let timer;
    const poll = async () => {
      try {
        const j = await api.get(`/api/import/jobs/${jobId}`);
        setJob(j);
        if (j.status === 'running') timer = setTimeout(poll, 1200);
      } catch { timer = setTimeout(poll, 3000); }
    };
    poll();
    return () => clearTimeout(timer);
  }, [jobId]);
  if (!job) return <Loading />;
  const rep = job.report || { imported: [], skipped: [], failed: [] };
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
  return (
    <div className="card pad">
      <h2 style={{ marginBottom: 14 }}>{job.status === 'running' ? t('Import läuft …') : t('Import abgeschlossen')}</h2>
      <div className="progress"><div style={{ width: `${pct}%` }} /></div>
      <p className="small muted" style={{ marginTop: 8 }}>{t('{a} von {b} verarbeitet', { a: job.done, b: job.total })} ({pct} %)</p>
      <div className="grid-3 mt">
        <div className="card pad center"><CheckCircle2 color="var(--green)" /><h2>{rep.imported.length}</h2><span className="small muted">{t('importiert')}</span></div>
        <div className="card pad center"><SkipForward color="var(--yellow)" /><h2>{rep.skipped.length}</h2><span className="small muted">{t('übersprungen')}</span></div>
        <div className="card pad center"><XCircle color="var(--red)" /><h2>{rep.failed.length}</h2><span className="small muted">{t('fehlgeschlagen')}</span></div>
      </div>
      {rep.failed.length > 0 && (
        <div className="mt"><h3 style={{ marginBottom: 8 }}>{t('Fehlgeschlagen')}</h3>
          <div className="stack" style={{ gap: 6 }}>{rep.failed.map((f, i) => <div key={i} className="alert error"><b>{f.title}</b>: {f.reason}</div>)}</div>
        </div>
      )}
      {rep.skipped.length > 0 && (
        <div className="mt"><h3 style={{ marginBottom: 8 }}>{t('Übersprungen')}</h3>
          <div className="stack" style={{ gap: 6 }}>{rep.skipped.map((f, i) => <div key={i} className="alert warn"><b>{f.title}</b>: {f.reason}</div>)}</div>
        </div>
      )}
      {rep.imported.length > 0 && (
        <div className="mt"><h3 style={{ marginBottom: 8 }}>{t('Importiert')}</h3>
          <div className="chips">{rep.imported.slice(0, 200).map((r) => <Link key={r.id} to={`/recipes/${r.id}`} className="chip">{r.title}</Link>)}</div>
        </div>
      )}
      {job.status !== 'running' && <div className="btn-row mt-lg"><Link to="/recipes" className="btn primary">{t('Zu den Rezepten')}</Link><Link to="/import" className="btn">{t('Weiteren Import starten')}</Link></div>}
    </div>
  );
}

export default function ImportPage() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const { jobId } = useParams();
  const [mode, setMode] = useState(null);
  const [draft, setDraft] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [saving, setSaving] = useState(false);
  const formRef = useRef();
  useEffect(() => {
    if (mode) setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, [mode]);

  const options = [
    { key: 'manual', icon: PenLine, title: t('Selbst eingeben'), text: t('Rezept von Grund auf anlegen.') },
    { key: 'url', icon: Link2, title: t('Link einfügen'), text: t('Von einer Rezeptwebsite übernehmen.') },
    { key: 'photo', icon: Camera, title: t('Foto hochladen'), text: t('Gedruckt oder handschriftlich – mit KI-Erkennung.') },
    { key: 'tandoor', icon: Database, title: t('Aus Tandoor'), text: t('Bestehende Tandoor-Sammlung übernehmen.') },
    { key: 'file', icon: FileUp, title: t('Datei'), text: t('Rezeptdateien importieren und exportieren.') },
  ];

  const onDraft = (d, w) => { setDraft(d); setWarnings(w || []); window.scrollTo(0, 0); };
  const save = async (data) => {
    setSaving(true);
    try {
      const r = await api.post('/api/recipes', { ...data, change_note: t('Importiert') });
      toast(t('Rezept gespeichert'));
      navigate(`/recipes/${r.id}`);
    } catch (e) { toast(e.message, { type: 'error' }); } finally { setSaving(false); }
  };

  if (jobId) {
    return <div className="page narrow"><div className="page-head"><h1>{t('Import')}</h1></div><JobView jobId={jobId} /></div>;
  }

  if (draft) {
    return (
      <div className="page narrow">
        <button className="btn ghost small" onClick={() => setDraft(null)}><ChevronLeft size={18} />{t('Zurück')}</button>
        <div className="page-head mt"><div><h1>{t('Vorschau prüfen')}</h1><p className="sub">{t('Korrigiere alles Nötige, bevor du das Rezept speicherst.')}</p></div></div>
        {warnings.length > 0 && <Alert type="warn">{warnings.join(' · ')}</Alert>}
        <RecipeForm initial={draft} mode="import" onSave={save} saving={saving} onCancel={() => setDraft(null)} />
      </div>
    );
  }

  return (
    <div className="page narrow">
      <div className="page-head"><div><h1>{t('Rezept hinzufügen')}</h1><p className="sub">{t('Wie möchtest du dein Rezept hinzufügen?')}</p></div></div>
      <div className="import-options">
        {options.map((o) => (
          <button key={o.key} className={`import-option ${mode === o.key ? 'active' : ''}`} onClick={() => (o.key === 'manual' ? navigate('/recipes/new') : setMode(o.key))}>
            <span className="ico"><o.icon size={22} /></span>
            <b>{o.title}</b>
            <span className="small muted">{o.text}</span>
          </button>
        ))}
      </div>
      <div className="mt-lg" ref={formRef} style={{ scrollMarginTop: 70 }}>
        {mode === 'url' && <UrlImport onDraft={onDraft} />}
        {mode === 'photo' && <PhotoImport onDraft={onDraft} />}
        {mode === 'tandoor' && <TandoorImport />}
        {mode === 'file' && <FileImport onDraft={onDraft} />}
      </div>
    </div>
  );
}
