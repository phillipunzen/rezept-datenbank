import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Plus, Trash2, ChevronUp, ChevronDown, ImagePlus, Star, X, ClipboardPaste, Save, AlertTriangle, Check, Wand2, UserPen,
  Thermometer, Timer,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app.jsx';
import { useT } from '../lib/i18n.js';
import { Loading, ErrorBox, Modal, Alert, useToast, Confirm } from '../components/ui.jsx';
import { emptyRecipe, CATEGORIES } from '../lib/recipe.js';
import { parseIngredientText } from '../lib/parse.js';
import { TM_MODES } from '../lib/format.js';

const move = (arr, i, d) => {
  const a = [...arr];
  const j = i + d;
  if (j < 0 || j >= a.length) return a;
  [a[i], a[j]] = [a[j], a[i]];
  return a;
};
const imgUrl = (p) => (p.startsWith('/') ? p : `/uploads/${p}`);

export function ImagesEditor({ images, onChange }) {
  const t = useT();
  const toast = useToast();
  const input = useRef();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const upload = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const fd = new FormData();
      [...files].forEach((f) => fd.append('files', f));
      const d = await api.upload('/api/uploads/image', fd);
      onChange([...images, ...d.images.map((i) => i.path)]);
    } catch (e) { toast(e.message, { type: 'error' }); } finally { setBusy(false); }
  };
  return (
    <div>
      <div className="image-strip">
        {images.map((p, i) => (
          <div className="image-tile" key={p}>
            <img src={imgUrl(p).replace('.webp', '.thumb.webp')} alt="" onError={(e) => { e.currentTarget.src = imgUrl(p); }} />
            <div className="tile-actions">
              {i > 0 && <button type="button" title={t('Als Titelbild')} onClick={() => onChange([p, ...images.filter((x) => x !== p)])}><Star size={14} /></button>}
              <button type="button" title={t('Entfernen')} onClick={() => onChange(images.filter((x) => x !== p))}><X size={14} /></button>
            </div>
            {i === 0 && <span className="badge accent cover-badge">{t('Titelbild')}</span>}
          </div>
        ))}
        <div className={`dropzone ${over ? 'over' : ''}`} style={{ width: 160, height: 90, padding: 10 }}
          onClick={() => input.current.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}>
          {busy ? <div className="spinner" /> : <><ImagePlus size={22} /><span className="tiny">{t('Bilder hinzufügen')}</span></>}
        </div>
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

function TagsInput({ value, onChange }) {
  const t = useT();
  const [text, setText] = useState('');
  const add = () => {
    const parts = text.split(',').map((x) => x.trim()).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setText('');
  };
  return (
    <div>
      <div className="chips" style={{ marginBottom: value.length ? 8 : 0 }}>
        {value.map((tg) => <span key={tg} className="chip active" onClick={() => onChange(value.filter((x) => x !== tg))}>#{tg}<X size={12} /></span>)}
      </div>
      <input className="input" placeholder={t('Tag eingeben und Enter drücken')} value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }} onBlur={add} />
    </div>
  );
}

function TmFields({ tm, onChange }) {
  const t = useT();
  const v = tm || {};
  const set = (k, val) => onChange({ ...v, [k]: val });
  const minutes = v.time ? Math.floor(v.time / 60) : '';
  const seconds = v.time ? v.time % 60 : '';
  return (
    <div className="tm-editor">
      <div>
        <label>{t('Zeit (Min:Sek)')}</label>
        <div className="row" style={{ gap: 4 }}>
          <input className="input small" type="number" min="0" placeholder="Min" value={minutes} onChange={(e) => set('time', (Number(e.target.value) || 0) * 60 + (Number(seconds) || 0))} />
          <input className="input small" type="number" min="0" max="59" placeholder="Sek" value={seconds} onChange={(e) => set('time', (Number(minutes) || 0) * 60 + (Number(e.target.value) || 0))} />
        </div>
      </div>
      <div>
        <label>{t('Temperatur')}</label>
        <input className="input small" list="tm-temps" placeholder="°C" value={v.temp || ''} onChange={(e) => set('temp', e.target.value)} />
      </div>
      <div>
        <label>{t('Stufe')}</label>
        <input className="input small" list="tm-speeds" placeholder="1–10" value={v.speed || ''} onChange={(e) => set('speed', e.target.value)} />
      </div>
      <div>
        <label>{t('Modus')}</label>
        <select className="input small" value={v.mode || ''} onChange={(e) => set('mode', e.target.value)}>
          <option value="">–</option>
          {Object.entries(TM_MODES).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
        </select>
      </div>
      <div>
        <label>{t('Linkslauf')}</label>
        <label className="switch" style={{ marginTop: 6 }}><input type="checkbox" checked={!!v.reverse} onChange={(e) => set('reverse', e.target.checked)} /></label>
      </div>
    </div>
  );
}

/**
 * Rezeptformular – wird für Neu, Bearbeiten, Thermomix-Vorbereitung, persönliche Version und Import-Vorschau verwendet.
 * mode: 'create' | 'edit' | 'thermomix' | 'variant' | 'import'
 */
export function RecipeForm({ initial, mode = 'edit', onSave, onCancel, saving, extra }) {
  const t = useT();
  const { groups } = useApp();
  const [r, setR] = useState(() => ({ ...emptyRecipe(), ...initial, tags: initial?.tags || [], images: initial?.images || [] }));
  const [paste, setPaste] = useState(null);
  const [showTm, setShowTm] = useState(mode === 'thermomix' || !!initial?.steps?.some((s) => s.tm));
  const [showNutrition, setShowNutrition] = useState(!!initial?.nutrition);
  const [groupId, setGroupId] = useState(initial?.group_id || '');
  const [changeNote, setChangeNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const variant = mode === 'variant';
  const tmOnly = mode === 'thermomix';

  useEffect(() => {
    const fn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, [dirty]);

  const upd = (patch) => { setR((x) => ({ ...x, ...patch })); setDirty(true); };
  const setGroup = (gi, patch) => upd({ ingredients: r.ingredients.map((g, i) => (i === gi ? { ...g, ...patch } : g)) });
  const setItem = (gi, ii, patch) => setGroup(gi, { items: r.ingredients[gi].items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) });
  const setStep = (si, patch) => upd({ steps: r.steps.map((s, i) => (i === si ? { ...s, ...patch } : s)) });
  const uncertainCount = r.ingredients.reduce((n, g) => n + g.items.filter((i) => i.uncertain).length, 0) + r.steps.filter((s) => s.uncertain).length;

  const submit = (e) => {
    e?.preventDefault();
    setDirty(false);
    onSave({ ...r, group_id: groupId || null, change_note: changeNote });
  };

  return (
    <form onSubmit={submit}>
      {tmOnly && <Alert type="info">{t('Ergänze für jeden Schritt Zeit, Temperatur, Stufe, Linkslauf oder Gerätemodus. Im Kochmodus werden die Einstellungen groß angezeigt und die Zeit kann als Timer gestartet werden.')}</Alert>}
      {variant && <Alert type="info">{t('Deine persönliche Version ändert nur deine Ansicht. Das gemeinsame Original bleibt unverändert.')}</Alert>}
      {uncertainCount > 0 && (
        <div className="mt"><Alert type="warn">
          <b>{t('{n} unsichere Angaben', { n: uncertainCount })}</b> – {t('gelb markierte Felder konnten nicht sicher erkannt werden. Bitte prüfen und mit ✓ bestätigen.')}
          {r.uncertain_notes?.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{r.uncertain_notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        </Alert></div>
      )}

      {!variant && !tmOnly && (
        <div className="card pad mt editor-section">
          <div className="field"><label>{t('Titel')} *</label><input className="input" style={{ fontSize: '1.15rem', fontWeight: 600 }} required value={r.title} onChange={(e) => upd({ title: e.target.value })} placeholder={t('z. B. Omas Apfelkuchen')} /></div>
          <div className="field"><label>{t('Beschreibung')}</label><textarea className="input" rows={3} value={r.description} onChange={(e) => upd({ description: e.target.value })} /></div>
          <div className="field"><label>{t('Bilder')}</label><ImagesEditor images={r.images} onChange={(images) => upd({ images })} /></div>
          <div className="grid-4">
            <div className="field"><label>{t('Portionen')}</label><input className="input" type="number" min="0.5" step="0.5" value={r.servings} onChange={(e) => upd({ servings: e.target.value })} /></div>
            <div className="field"><label>{t('Einheit')}</label><input className="input" placeholder={t('Portionen')} value={r.servings_unit || ''} onChange={(e) => upd({ servings_unit: e.target.value })} /></div>
            <div className="field"><label>{t('Kategorie')}</label>
              <input className="input" list="cats" value={r.category || ''} onChange={(e) => upd({ category: e.target.value })} />
              <datalist id="cats">{CATEGORIES.map((c) => <option key={c} value={t(c)} />)}</datalist>
            </div>
            <div className="field"><label>{t('Schwierigkeit')}</label>
              <select className="input" value={r.difficulty || ''} onChange={(e) => upd({ difficulty: e.target.value })}>
                <option value="">–</option><option value="easy">{t('Einfach')}</option><option value="medium">{t('Mittel')}</option><option value="hard">{t('Anspruchsvoll')}</option>
              </select>
            </div>
          </div>
          <div className="grid-3">
            <div className="field"><label>{t('Vorbereitung (Min.)')}</label><input className="input" type="number" min="0" value={r.prep_time ?? ''} onChange={(e) => upd({ prep_time: e.target.value })} /></div>
            <div className="field"><label>{t('Kochen/Backen (Min.)')}</label><input className="input" type="number" min="0" value={r.cook_time ?? ''} onChange={(e) => upd({ cook_time: e.target.value })} /></div>
            <div className="field"><label>{t('Ruhezeit (Min.)')}</label><input className="input" type="number" min="0" value={r.rest_time ?? ''} onChange={(e) => upd({ rest_time: e.target.value })} /></div>
          </div>
          <div className="field"><label>{t('Tags')}</label><TagsInput value={r.tags} onChange={(tags) => upd({ tags })} /></div>
          {(mode === 'create' || mode === 'import') && groups.length > 0 && (
            <div className="field">
              <label>{t('Speichern in')}</label>
              <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">{t('Privat')}</option>
                {groups.filter((g) => g.role !== 'viewer').map((g) => <option key={g.id} value={g.id}>{t('Gemeinsam')}: {g.name}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {variant && (
        <div className="card pad mt">
          <div className="field" style={{ maxWidth: 200 }}><label>{t('Portionen')}</label><input className="input" type="number" min="0.5" step="0.5" value={r.servings} onChange={(e) => upd({ servings: e.target.value })} /></div>
        </div>
      )}

      {!tmOnly && (
        <div className="card pad mt editor-section">
          <div className="card-title">
            <h2 style={{ fontSize: '1.2rem' }}>{t('Zutaten')}</h2>
            <button type="button" className="btn small" onClick={() => setPaste('')}><ClipboardPaste size={16} />{t('Als Text einfügen')}</button>
          </div>
          {r.ingredients.map((g, gi) => (
            <div className="group-box" key={gi}>
              <div className="row" style={{ marginBottom: 10 }}>
                <input className="input small" style={{ fontWeight: 650 }} placeholder={r.ingredients.length > 1 ? t('Gruppenname, z. B. Teig') : t('Gruppenname (optional, z. B. Teig, Sauce, Belag)')} value={g.name} onChange={(e) => setGroup(gi, { name: e.target.value })} />
                {r.ingredients.length > 1 && <>
                  <button type="button" className="btn ghost icon small" onClick={() => upd({ ingredients: move(r.ingredients, gi, -1) })}><ChevronUp size={16} /></button>
                  <button type="button" className="btn ghost icon small" onClick={() => upd({ ingredients: move(r.ingredients, gi, 1) })}><ChevronDown size={16} /></button>
                  <button type="button" className="btn ghost icon small" onClick={() => upd({ ingredients: r.ingredients.filter((_, i) => i !== gi) })}><Trash2 size={16} /></button>
                </>}
              </div>
              {g.items.map((it, ii) => (
                <div className="ing-row" key={ii}>
                  <span className="drag" style={{ flexDirection: 'column' }}>
                    <ChevronUp size={13} style={{ cursor: 'pointer' }} onClick={() => setGroup(gi, { items: move(g.items, ii, -1) })} />
                    <ChevronDown size={13} style={{ cursor: 'pointer' }} onClick={() => setGroup(gi, { items: move(g.items, ii, 1) })} />
                  </span>
                  <input className={`input small ${it.uncertain ? 'uncertain' : ''}`} inputMode="decimal" placeholder={t('Menge')} value={it.amount ?? ''} onChange={(e) => setItem(gi, ii, { amount: e.target.value })} />
                  <input className={`input small ${it.uncertain ? 'uncertain' : ''}`} list="units" placeholder={t('Einheit')} value={it.unit || ''} onChange={(e) => setItem(gi, ii, { unit: e.target.value })} />
                  <input className={`input small ${it.uncertain ? 'uncertain' : ''}`} placeholder={t('Zutat')} value={it.name} onChange={(e) => setItem(gi, ii, { name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setGroup(gi, { items: [...g.items.slice(0, ii + 1), { amount: '', unit: '', name: '', note: '' }, ...g.items.slice(ii + 1)] }); } }} />
                  <input className="input small ing-note-input" placeholder={t('Hinweis, z. B. gehackt')} value={it.note || ''} onChange={(e) => setItem(gi, ii, { note: e.target.value })} />
                  {it.uncertain
                    ? <button type="button" className="btn ghost icon small" title={t('Bestätigen')} onClick={() => setItem(gi, ii, { uncertain: false })} style={{ color: 'var(--green)' }}><Check size={16} /></button>
                    : <button type="button" className="btn ghost icon small" onClick={() => setGroup(gi, { items: g.items.filter((_, j) => j !== ii) })}><X size={16} /></button>}
                </div>
              ))}
              <button type="button" className="btn ghost small" onClick={() => setGroup(gi, { items: [...g.items, { amount: '', unit: '', name: '', note: '' }] })}><Plus size={16} />{t('Zutat')}</button>
            </div>
          ))}
          <button type="button" className="btn small" onClick={() => upd({ ingredients: [...r.ingredients, { name: '', items: [{ amount: '', unit: '', name: '', note: '' }] }] })}><Plus size={16} />{t('Zutatengruppe')}</button>
          <datalist id="units">{['g', 'kg', 'ml', 'l', 'EL', 'TL', 'Prise', 'Stück', 'Zehe', 'Bund', 'Dose', 'Pck', 'Tasse', 'Becher', 'Scheibe', 'Msp', 'Handvoll'].map((u) => <option key={u} value={u} />)}</datalist>
        </div>
      )}

      <div className="card pad mt editor-section">
        <div className="card-title">
          <h2 style={{ fontSize: '1.2rem' }}>{t('Zubereitung')}</h2>
          {!tmOnly && <label className="switch small"><input type="checkbox" checked={showTm} onChange={(e) => setShowTm(e.target.checked)} />{t('Thermomix-Angaben')}</label>}
        </div>
        {r.steps.map((s, si) => (
          <div className="step-row" key={si}>
            <span className="step-num">{si + 1}</span>
            <div>
              {!tmOnly && <input className="input small" style={{ marginBottom: 6 }} placeholder={t('Überschrift (optional)')} value={s.title || ''} onChange={(e) => setStep(si, { title: e.target.value })} />}
              {tmOnly ? <p style={{ whiteSpace: 'pre-line', marginBottom: 4 }}>{s.text}</p> : (
                <textarea className={`input ${s.uncertain ? 'uncertain' : ''}`} rows={3} placeholder={t('Was ist zu tun?')} value={s.text} onChange={(e) => setStep(si, { text: e.target.value })} />
              )}
              <div className="row wrap" style={{ marginTop: 6 }}>
                <span className="small faint row" style={{ gap: 4 }}><Timer size={14} />{t('Timer (Min.)')}</span>
                <input className="input small" style={{ width: 90 }} type="number" min="0" step="0.5" value={s.timer ? s.timer / 60 : ''} onChange={(e) => setStep(si, { timer: e.target.value ? Math.round(Number(e.target.value) * 60) : null })} />
                {s.uncertain && <button type="button" className="btn small" onClick={() => setStep(si, { uncertain: false })}><Check size={15} />{t('Bestätigen')}</button>}
              </div>
              {(showTm || tmOnly) && <TmFields tm={s.tm} onChange={(tm) => setStep(si, { tm })} />}
            </div>
            {!tmOnly && (
              <div className="stack" style={{ gap: 2 }}>
                <button type="button" className="btn ghost icon small" onClick={() => upd({ steps: move(r.steps, si, -1) })}><ChevronUp size={16} /></button>
                <button type="button" className="btn ghost icon small" onClick={() => upd({ steps: move(r.steps, si, 1) })}><ChevronDown size={16} /></button>
                <button type="button" className="btn ghost icon small" onClick={() => upd({ steps: r.steps.filter((_, i) => i !== si) })}><Trash2 size={16} /></button>
              </div>
            )}
          </div>
        ))}
        {!tmOnly && <button type="button" className="btn small" onClick={() => upd({ steps: [...r.steps, { text: '' }] })}><Plus size={16} />{t('Schritt')}</button>}
        <datalist id="tm-temps">{['37', '50', '60', '70', '80', '90', '98', '100', '110', '120', 'Varoma'].map((x) => <option key={x} value={x} />)}</datalist>
        <datalist id="tm-speeds">{['Sanftrührstufe', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Turbo', 'Teigstufe'].map((x) => <option key={x} value={x} />)}</datalist>
        {tmOnly && (
          <div className="grid-2 mt">
            <label className="switch"><input type="checkbox" checked={!!r.thermomix} onChange={(e) => upd({ thermomix: e.target.checked })} />{t('Als Thermomix-Rezept kennzeichnen')}</label>
            <div className="field" style={{ marginBottom: 0 }}>
              <select className="input" value={r.tm_model || ''} onChange={(e) => upd({ tm_model: e.target.value })}>
                <option value="">{t('Gerätemodell (optional)')}</option><option>TM5</option><option>TM6</option><option>TM7</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {!tmOnly && (
        <div className="card pad mt editor-section">
          <div className="field"><label>{variant ? t('Notizen zu meiner Version') : t('Notizen (für alle mit Zugriff sichtbar)')}</label><textarea className="input" value={r.notes || ''} onChange={(e) => upd({ notes: e.target.value })} /></div>
          {!variant && (
            <>
              <div className="grid-2">
                <div className="field"><label>{t('Quelle (Link)')}</label><input className="input" type="url" value={r.source_url || ''} onChange={(e) => upd({ source_url: e.target.value })} /></div>
                <div className="field"><label>{t('Quellenangabe (intern)')}</label><input className="input" value={r.source_note || ''} onChange={(e) => upd({ source_note: e.target.value })} placeholder={t('z. B. Kochbuch, Seite 42')} /></div>
              </div>
              <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>{t('Quellen und Notizen werden in öffentlichen Ansichten nicht angezeigt.')}</p>
              <label className="switch"><input type="checkbox" checked={showNutrition} onChange={(e) => setShowNutrition(e.target.checked)} />{t('Nährwerte angeben')}</label>
              {showNutrition && (
                <div className="grid-3 mt">
                  {[['calories', 'Kalorien (kcal)'], ['protein', 'Eiweiß (g)'], ['carbs', 'Kohlenhydrate (g)'], ['fat', 'Fett (g)'], ['fiber', 'Ballaststoffe (g)'], ['sugar', 'Zucker (g)']].map(([k, l]) => (
                    <div className="field" key={k}><label>{t(l)}</label><input className="input" type="number" min="0" step="any" value={r.nutrition?.[k] ?? ''} onChange={(e) => upd({ nutrition: { ...(r.nutrition || {}), [k]: e.target.value } })} /></div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {mode === 'edit' && <div className="field mt"><label>{t('Was hast du geändert? (optional, für den Verlauf)')}</label><input className="input" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} /></div>}
      {extra}

      <div className="save-bar">
        {onCancel && <button type="button" className="btn" onClick={onCancel}>{t('Abbrechen')}</button>}
        <button className="btn primary" disabled={saving}><Save size={18} />{saving ? t('Speichert …') : mode === 'import' ? t('Rezept speichern') : t('Speichern')}</button>
      </div>

      {paste != null && (
        <Modal title={t('Zutaten als Text einfügen')} onClose={() => setPaste(null)} footer={<>
          <button type="button" className="btn" onClick={() => setPaste(null)}>{t('Abbrechen')}</button>
          <button type="button" className="btn primary" onClick={() => {
            const parsed = parseIngredientText(paste);
            const existing = r.ingredients.filter((g) => g.items.some((i) => i.name));
            upd({ ingredients: [...existing, ...parsed] });
            setPaste(null);
          }}>{t('Übernehmen')}</button>
        </>}>
          <p className="hint" style={{ marginBottom: 8 }}>{t('Eine Zutat pro Zeile. Zeilen mit Doppelpunkt am Ende werden zu Gruppen, z. B. „Teig:“.')}</p>
          <textarea className="input" rows={10} autoFocus value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Teig:\n250 g Mehl\n1 Prise Salz\n\nBelag:\n200 g Tomaten, gewürfelt'} />
        </Modal>
      )}
    </form>
  );
}

export default function RecipeEditor({ thermomix, variant }) {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const { id } = useParams();
  const [recipe, setRecipe] = useState(id ? null : emptyRecipe());
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.get(`/api/recipes/${id}`).then((r) => {
      if (variant && r.personal?.variant) {
        const v = r.personal.variant;
        setRecipe({ ...r, servings: v.servings || r.servings, ingredients: v.ingredients || r.ingredients, steps: v.steps || r.steps, notes: v.notes || '' });
      } else if (variant) setRecipe({ ...r, notes: '' });
      else setRecipe(r);
    }).catch(setError);
  }, [id, variant]);

  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!recipe) return <Loading />;

  const mode = variant ? 'variant' : thermomix ? 'thermomix' : id ? 'edit' : 'create';
  const save = async (data) => {
    setSaving(true);
    try {
      if (variant) {
        await api.put(`/api/recipes/${id}/personal`, { variant: { servings: data.servings, ingredients: data.ingredients, steps: data.steps, notes: data.notes } });
        toast(t('Deine Version wurde gespeichert'));
        navigate(`/recipes/${id}`);
      } else if (id) {
        await api.put(`/api/recipes/${id}`, thermomix ? { ...recipe, steps: data.steps, thermomix: data.thermomix, tm_model: data.tm_model, change_note: t('Thermomix-Angaben bearbeitet') } : data);
        toast(t('Gespeichert'));
        navigate(`/recipes/${id}`);
      } else {
        const r = await api.post('/api/recipes', data);
        toast(t('Rezept angelegt'));
        navigate(`/recipes/${r.id}`, { replace: true });
      }
    } catch (e) {
      toast(e.message, { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const title = variant ? t('Meine Version') : thermomix ? t('Für Thermomix vorbereiten') : id ? t('Rezept bearbeiten') : t('Neues Rezept');
  const Icon = variant ? UserPen : thermomix ? Wand2 : null;
  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <h1>{Icon && <Icon size={28} style={{ verticalAlign: -4, marginRight: 8 }} />}{title}</h1>
          {id && <p className="sub">{recipe.title}</p>}
        </div>
        {variant && recipe.personal?.variant && <button className="btn danger small" onClick={() => setConfirmReset(true)}><Trash2 size={16} />{t('Anpassung entfernen')}</button>}
        {thermomix && <span className="badge green"><Thermometer size={13} />Thermomix</span>}
      </div>
      {recipe.perm === 'view' && !variant && <Alert type="warn"><AlertTriangle size={16} /> {t('Du darfst dieses Rezept nur ansehen.')}</Alert>}
      <RecipeForm initial={recipe} mode={mode} onSave={save} saving={saving} onCancel={() => navigate(id ? `/recipes/${id}` : '/recipes')} />
      {confirmReset && <Confirm title={t('Anpassung entfernen?')} text={t('Deine persönliche Version wird gelöscht. Danach siehst du wieder das Original.')} danger
        onConfirm={async () => { await api.put(`/api/recipes/${id}/personal`, { variant: null }); navigate(`/recipes/${id}`); }} onClose={() => setConfirmReset(false)} />}
    </div>
  );
}
