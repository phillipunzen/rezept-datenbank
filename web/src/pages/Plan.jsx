import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Sparkles, ShoppingCart, ChefHat, Trash2, Move, BookOpen, X, Users } from 'lucide-react';
import { api, onServerEvent } from '../lib/api.js';
import { useApp } from '../lib/app.jsx';
import { useT } from '../lib/i18n.js';
import { useApi, Loading, ErrorBox, Modal, Menu, useToast, Alert } from '../components/ui.jsx';
import { RecipePicker, MEALS, MEAL_LABEL, ListSelect } from '../components/dialogs.jsx';
import { isoDate, startOfWeek, addDays, formatDate } from '../lib/format.js';

function useIsMobile() {
  const [m, setM] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const fn = () => setM(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return m;
}

function MoveDialog({ entry, onClose }) {
  const t = useT();
  const [date, setDate] = useState(entry.date);
  const [meal, setMeal] = useState(entry.meal);
  const [servings, setServings] = useState(entry.servings || '');
  return (
    <Modal title={entry.title} onClose={() => onClose()} footer={<>
      <button className="btn" onClick={() => onClose()}>{t('Abbrechen')}</button>
      <button className="btn primary" onClick={async () => { await api.put(`/api/plan/${entry.id}`, { date, meal, servings }); onClose(true); }}>{t('Speichern')}</button>
    </>}>
      <div className="grid-2">
        <div className="field"><label>{t('Datum')}</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label>{t('Portionen')}</label><input type="number" min="1" className="input" value={servings} onChange={(e) => setServings(e.target.value)} /></div>
      </div>
      <div className="field"><label>{t('Mahlzeit')}</label>
        <div className="chips">{MEALS.map((m) => <button key={m} className={`chip ${meal === m ? 'active' : ''}`} onClick={() => setMeal(m)}>{t(MEAL_LABEL[m])}</button>)}</div>
      </div>
    </Modal>
  );
}

function SuggestDialog({ from, to, scope, onApply, onClose }) {
  const t = useT();
  const [meals, setMeals] = useState(['dinner']);
  const [maxTime, setMaxTime] = useState('');
  const [pantry, setPantry] = useState(false);
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const d = await api.post('/api/plan/suggest', { from, to, scope, meals, max_time: maxTime || null, prefer_pantry: pantry });
      setItems(d.items);
    } finally { setBusy(false); }
  };
  return (
    <Modal title={t('Wochenplan zusammenstellen')} onClose={onClose} wide footer={items ? <>
      <button className="btn" onClick={() => setItems(null)}>{t('Neu vorschlagen')}</button>
      <button className="btn primary" disabled={!items.length} onClick={() => onApply(items)}>{t('{n} Vorschläge übernehmen', { n: items.length })}</button>
    </> : <><button className="btn" onClick={onClose}>{t('Abbrechen')}</button><button className="btn primary" disabled={busy || !meals.length} onClick={run}><Sparkles size={17} />{t('Vorschläge erstellen')}</button></>}>
      {!items ? (
        <>
          <p className="muted small" style={{ marginBottom: 14 }}>{t('Freie Mahlzeiten dieser Woche werden mit passenden Rezepten gefüllt – Favoriten und gut bewertete Rezepte zuerst, kürzlich gekochte seltener, mit Abwechslung bei den Kategorien.')}</p>
          <div className="field"><label>{t('Welche Mahlzeiten?')}</label>
            <div className="chips">{MEALS.map((m) => <button key={m} className={`chip ${meals.includes(m) ? 'active' : ''}`} onClick={() => setMeals(meals.includes(m) ? meals.filter((x) => x !== m) : [...meals, m])}>{t(MEAL_LABEL[m])}</button>)}</div>
          </div>
          <div className="grid-2">
            <div className="field"><label>{t('Maximale Zeit')}</label>
              <select className="input" value={maxTime} onChange={(e) => setMaxTime(e.target.value)}>
                <option value="">{t('Egal')}</option>{[20, 30, 45, 60].map((m) => <option key={m} value={m}>≤ {m} {t('Min.')}</option>)}
              </select>
            </div>
            <div className="field"><label>&nbsp;</label><label className="switch"><input type="checkbox" checked={pantry} onChange={(e) => setPantry(e.target.checked)} />{t('Vorräte bevorzugen')}</label></div>
          </div>
        </>
      ) : items.length ? (
        <div className="stack" style={{ gap: 6 }}>
          {items.map((s, i) => (
            <div key={i} className="row card" style={{ padding: 8 }}>
              {s.recipe.thumb_url ? <img src={s.recipe.thumb_url} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} /> : <div style={{ width: 48, height: 48 }} />}
              <div style={{ flex: 1 }}><div className="tiny faint">{formatDate(s.date, t.lang, { weekday: 'short', day: 'numeric', month: 'short' })} · {t(MEAL_LABEL[s.meal])}</div><b>{s.recipe.title}</b></div>
              <button className="btn ghost icon small" onClick={() => setItems(items.filter((_, j) => j !== i))}><X size={16} /></button>
            </div>
          ))}
        </div>
      ) : <Alert type="info">{t('Keine passenden Rezepte gefunden oder alle Mahlzeiten sind bereits geplant.')}</Alert>}
    </Modal>
  );
}

function ShoppingFromPlan({ days, scope, onClose }) {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(new Set(days.map((d) => d.iso)));
  const [listId, setListId] = useState(undefined);
  const [name, setName] = useState(t('Wochenplan'));
  const [skipPantry, setSkipPantry] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const sorted = [...selected].sort();
      const plan = await api.get(`/api/plan?from=${sorted[0]}&to=${sorted[sorted.length - 1]}${scope ? `&scope=${scope}` : ''}`);
      const ids = plan.items.filter((e) => selected.has(e.date) && e.recipe_id).map((e) => e.id);
      if (!ids.length) { toast(t('In den gewählten Tagen sind keine Rezepte geplant'), { type: 'error' }); setBusy(false); return; }
      const d = await api.post('/api/plan/shopping', { from: sorted[0], to: sorted[sorted.length - 1], scope, entry_ids: ids, list_id: listId === 'new' ? null : listId, name, skip_pantry: skipPantry });
      toast(t('{n} Einträge aus {r} Rezepten übernommen', { n: d.added, r: d.recipes }));
      navigate(`/shopping/${d.list_id}`);
    } catch (e) { toast(e.message, { type: 'error' }); setBusy(false); }
  };
  return (
    <Modal title={t('Einkaufsliste aus dem Plan')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Abbrechen')}</button><button className="btn primary" disabled={busy || !selected.size} onClick={run}><ShoppingCart size={17} />{t('Erstellen')}</button></>}>
      <div className="field"><label>{t('Tage')}</label>
        <div className="chips">
          {days.map((d) => <button key={d.iso} className={`chip ${selected.has(d.iso) ? 'active' : ''}`} onClick={() => { const n = new Set(selected); if (n.has(d.iso)) n.delete(d.iso); else n.add(d.iso); setSelected(n); }}>{formatDate(d.date, t.lang, { weekday: 'short', day: 'numeric' })}</button>)}
        </div>
        <div className="row small"><span className="link" onClick={() => setSelected(new Set(days.map((d) => d.iso)))}>{t('Ganze Woche')}</span><span className="link" onClick={() => setSelected(new Set())}>{t('Keine')}</span></div>
      </div>
      <ListSelect value={listId} onChange={setListId} />
      {listId === 'new' && <div className="field"><label>{t('Name der neuen Liste')}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>}
      <label className="switch"><input type="checkbox" checked={skipPantry} onChange={(e) => setSkipPantry(e.target.checked)} />{t('Zutaten aus dem Vorratsschrank weglassen')}</label>
      <p className="hint mt">{t('Gleiche Zutaten werden zusammengefasst und Mengen an die geplanten Portionen angepasst.')}</p>
    </Modal>
  );
}

export default function Plan() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const { groups } = useApp();
  const mobile = useIsMobile();
  const [week, setWeek] = useState(() => startOfWeek(new Date()));
  const [dayIdx, setDayIdx] = useState(() => (new Date().getDay() + 6) % 7);
  const [view, setView] = useState(null);
  const [scope, setScope] = useState(() => localStorage.getItem('plan-scope') || '');
  const [picker, setPicker] = useState(null);
  const [moving, setMoving] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [dragOver, setDragOver] = useState(null);
  const mode = view || (mobile ? 'day' : 'week');

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = addDays(week, i); return { date: d, iso: isoDate(d) }; }), [week]);
  const from = days[0].iso;
  const to = days[6].iso;
  const writable = !scope || groups.find((g) => String(g.id) === scope)?.role !== 'viewer';
  const { data, error, loading, reload, setData } = useApi(`/api/plan?from=${from}&to=${to}${scope ? `&scope=${scope}` : '&scope=personal'}`);
  useEffect(() => onServerEvent((ev) => ev.type === 'plan' && reload()), [reload]);
  useEffect(() => { localStorage.setItem('plan-scope', scope); }, [scope]);
  useEffect(() => { if (scope && groups.length && !groups.some((g) => String(g.id) === scope)) setScope(''); }, [groups, scope]);

  const today = isoDate(new Date());
  const entriesFor = (iso, meal) => (data?.items || []).filter((e) => e.date === iso && e.meal === meal);
  const suggestionsFor = (iso, meal) => suggestions.filter((s) => s.date === iso && s.meal === meal);

  const add = async (recipe) => {
    const { date, meal } = picker;
    setPicker(null);
    try {
      await api.post('/api/plan', { date, meal, recipe_id: recipe.id || null, title: recipe.id ? null : recipe.title, group_id: scope || null });
      reload();
    } catch (e) { toast(e.message, { type: 'error' }); }
  };
  const remove = async (entry) => {
    setData((d) => ({ ...d, items: d.items.filter((e) => e.id !== entry.id) }));
    await api.del(`/api/plan/${entry.id}`);
  };
  const drop = async (e, iso, meal) => {
    e.preventDefault();
    setDragOver(null);
    const entryId = Number(e.dataTransfer.getData('text/plain'));
    if (!entryId) return;
    setData((d) => ({ ...d, items: d.items.map((x) => (x.id === entryId ? { ...x, date: iso, meal } : x)) }));
    await api.put(`/api/plan/${entryId}`, { date: iso, meal }).catch(() => reload());
  };
  const applySuggestions = async (items) => {
    setDialog(null);
    for (const s of items) await api.post('/api/plan', { date: s.date, meal: s.meal, recipe_id: s.recipe.id, group_id: scope || null });
    setSuggestions([]);
    toast(t('{n} Mahlzeiten eingeplant', { n: items.length }));
    reload();
  };

  const entryCard = (e) => (
    <div key={e.id} className="meal" draggable={writable} onDragStart={(ev) => ev.dataTransfer.setData('text/plain', String(e.id))}>
      {e.image_url ? <img src={e.image_url} alt="" /> : <div className="noimg" />}
      <span className="meal-title" onClick={() => e.recipe_id && navigate(`/recipes/${e.recipe_id}`)} style={{ cursor: e.recipe_id ? 'pointer' : 'default' }}>
        {e.title}
        {e.servings ? <span className="faint tiny" style={{ fontWeight: 500 }}> · {e.servings} P.</span> : null}
      </span>
      {writable && (
        <Menu trigger={({ toggle }) => <button className="btn ghost icon small" style={{ width: 26, minWidth: 26, minHeight: 26 }} onClick={toggle}>⋮</button>}>
          {e.recipe_id && <button onClick={() => navigate(`/recipes/${e.recipe_id}`)}><BookOpen size={16} />{t('Rezept öffnen')}</button>}
          {e.recipe_id && <button onClick={() => navigate(`/recipes/${e.recipe_id}/cook?servings=${e.servings || ''}`)}><ChefHat size={16} />{t('Kochvorgang starten')}</button>}
          <button onClick={() => setMoving(e)}><Move size={16} />{t('Verschieben / Portionen')}</button>
          <button className="danger" onClick={() => remove(e)}><Trash2 size={16} />{t('Entfernen')}</button>
        </Menu>
      )}
    </div>
  );

  const slot = (d, meal) => (
    <div key={meal} className={`slot ${dragOver === `${d.iso}|${meal}` ? 'over' : ''}`}
      onDragOver={(e) => { if (writable) { e.preventDefault(); setDragOver(`${d.iso}|${meal}`); } }} onDragLeave={() => setDragOver(null)} onDrop={(e) => drop(e, d.iso, meal)}>
      <div className="slot-label">
        {t(MEAL_LABEL[meal])}
        {writable && <button onClick={() => setPicker({ date: d.iso, meal })} aria-label={t('Hinzufügen')}><Plus size={15} /></button>}
      </div>
      {entriesFor(d.iso, meal).map(entryCard)}
      {suggestionsFor(d.iso, meal).map((s, i) => (
        <div key={`s${i}`} className="meal suggested"><span className="meal-title">{s.recipe.title}</span></div>
      ))}
    </div>
  );

  const shownDays = mode === 'day' ? [days[dayIdx]] : days;

  return (
    <div className="page" style={{ maxWidth: mode === 'week' ? 1600 : 760 }}>
      <div className="page-head">
        <div>
          <h1>{t('Wochenplan')}</h1>
          <p className="sub">{formatDate(days[0].date, t.lang, { day: 'numeric', month: 'short' })} – {formatDate(days[6].date, t.lang, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
        </div>
        <div className="btn-row">
          {writable && <button className="btn" onClick={() => setDialog('suggest')}><Sparkles size={18} />{t('Vorschläge')}</button>}
          <button className="btn primary" onClick={() => setDialog('shop')}><ShoppingCart size={18} />{t('Einkaufsliste')}</button>
        </div>
      </div>

      <div className="plan-toolbar">
        <div className="row" style={{ gap: 4 }}>
          <button className="btn icon" onClick={() => (mode === 'day' && dayIdx > 0 ? setDayIdx(dayIdx - 1) : (setWeek(addDays(week, -7)), mode === 'day' && setDayIdx(6)))}><ChevronLeft size={20} /></button>
          <button className="btn" onClick={() => { setWeek(startOfWeek(new Date())); setDayIdx((new Date().getDay() + 6) % 7); }}>{t('Heute')}</button>
          <button className="btn icon" onClick={() => (mode === 'day' && dayIdx < 6 ? setDayIdx(dayIdx + 1) : (setWeek(addDays(week, 7)), mode === 'day' && setDayIdx(0)))}><ChevronRight size={20} /></button>
        </div>
        <div className="segmented">
          <button className={mode === 'day' ? 'active' : ''} onClick={() => setView('day')}>{t('Tag')}</button>
          <button className={mode === 'week' ? 'active' : ''} onClick={() => setView('week')}>{t('Woche')}</button>
        </div>
        <span className="spacer" />
        {groups.length > 0 && (
          <select className="input" style={{ width: 'auto', minWidth: 170 }} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">{t('Mein Plan')}</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
      </div>
      {mode === 'day' && (
        <div className="chips scroll" style={{ marginBottom: 14 }}>
          {days.map((d, i) => (
            <button key={d.iso} className={`chip ${i === dayIdx ? 'active' : ''}`} onClick={() => setDayIdx(i)}>
              {formatDate(d.date, t.lang, { weekday: 'short' })} {d.date.getDate()}.{d.iso === today ? ' •' : ''}
            </button>
          ))}
        </div>
      )}
      {!writable && <div style={{ marginBottom: 12 }}><Alert type="info"><Users size={14} /> {t('Du kannst diesen gemeinsamen Plan nur ansehen.')}</Alert></div>}
      {data?.__offline && <div style={{ marginBottom: 12 }}><Alert type="warn">{t('Offline – gespeicherter Stand wird angezeigt.')}</Alert></div>}
      {loading && !data ? <Loading /> : <ErrorBox error={error} onRetry={reload} />}

      {data && (
        <div className={mode === 'week' ? 'week' : 'dayview'}>
          {shownDays.map((d) => (
            <div key={d.iso} className={`day ${d.iso === today ? 'today' : ''}`}>
              <div className="day-head">
                <b>{formatDate(d.date, t.lang, { weekday: mode === 'week' ? 'short' : 'long' })}</b>
                <span>{formatDate(d.date, t.lang, { day: 'numeric', month: 'short' })}</span>
              </div>
              {MEALS.map((m) => slot(d, m))}
            </div>
          ))}
        </div>
      )}
      {mode === 'day' && data && (
        <div className="btn-row mt">
          <button className="btn small" onClick={() => setDialog('shopDay')}><ShoppingCart size={16} />{t('Einkaufsliste für diesen Tag')}</button>
        </div>
      )}

      {picker && <RecipePicker title={`${t(MEAL_LABEL[picker.meal])} · ${formatDate(picker.date, t.lang, { weekday: 'long', day: 'numeric', month: 'short' })}`} onPick={add} onClose={() => setPicker(null)} />}
      {moving && <MoveDialog entry={moving} onClose={(c) => { setMoving(null); if (c) reload(); }} />}
      {dialog === 'suggest' && <SuggestDialog from={from} to={to} scope={scope || 'personal'} onApply={applySuggestions} onClose={() => setDialog(null)} />}
      {dialog === 'shop' && <ShoppingFromPlan days={days} scope={scope || 'personal'} onClose={() => setDialog(null)} />}
      {dialog === 'shopDay' && <ShoppingFromPlan days={[days[dayIdx]]} scope={scope || 'personal'} onClose={() => setDialog(null)} />}
      <p className="hint mt-lg">{t('Tipp: Ziehe Mahlzeiten mit der Maus auf einen anderen Tag, um sie zu verschieben.')} <Link to="/pantry" className="link">{t('Was kann ich mit meinen Vorräten kochen?')}</Link></p>
    </div>
  );
}
