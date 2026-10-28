import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChefHat, Heart, CalendarPlus, ShoppingCart, MoreHorizontal, Pencil, Copy, Trash2, Printer, History, Share2,
  Library, Clock, Users, Gauge, Minus, Plus, ChevronLeft, ChevronRight, Thermometer, RotateCcw, Timer, Download,
  CloudOff, Cloud, Globe, ExternalLink, Wand2, UserPen, Lock,
} from 'lucide-react';
import { api, cacheRecipeOffline } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { useApi, Loading, ErrorBox, Menu, Stars, Confirm, useToast } from '../components/ui.jsx';
import { AddToPlanDialog, AddToShoppingDialog, CookbookDialog, ShareDialog, CookLog } from '../components/dialogs.jsx';
import { formatAmount, formatMinutes, formatSeconds, tmTemp, TM_MODES, formatDateTime } from '../lib/format.js';
import { applyVariant } from '../lib/recipe.js';

export function TmBadge({ tm, t }) {
  if (!tm) return null;
  return (
    <div className="tm-badge">
      {tm.time ? <span><Timer size={15} />{formatSeconds(tm.time)}</span> : null}
      {tm.temp ? <span><Thermometer size={15} />{tmTemp(tm.temp)}</span> : null}
      {tm.reverse ? <span><RotateCcw size={15} />{t('Linkslauf')}</span> : null}
      {tm.speed ? <span><Gauge size={15} />{t('Stufe')} {tm.speed}</span> : null}
      {tm.mode ? <span>{t(TM_MODES[tm.mode] || tm.mode)}</span> : null}
    </div>
  );
}

export function Ingredients({ groups, factor, t, checkable = true }) {
  const [done, setDone] = useState(new Set());
  return groups.map((g, gi) => (
    <div className="ing-group" key={gi}>
      {g.name && <h4>{g.name}</h4>}
      <ul className="ing-list">
        {g.items.map((i, ii) => {
          const k = `${gi}-${ii}`;
          return (
            <li key={k} className={done.has(k) ? 'done' : ''} onClick={() => {
              if (!checkable) return;
              const n = new Set(done);
              if (n.has(k)) n.delete(k); else n.add(k);
              setDone(n);
            }}>
              <span className="ing-amount">{formatAmount(i.amount != null ? i.amount * factor : null, i.unit)} {i.unit}</span>
              <span>{i.name}{i.note && <span className="ing-note">, {i.note}</span>}</span>
            </li>
          );
        })}
      </ul>
    </div>
  ));
}

export default function RecipeDetail() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const { id } = useParams();
  const { data: recipe, error, loading, reload, setData } = useApi(`/api/recipes/${id}`);
  const [servings, setServings] = useState(null);
  const [img, setImg] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [useVariant, setUseVariant] = useState(true);
  const [personalNote, setPersonalNote] = useState(null);

  useEffect(() => { setServings(null); setImg(0); setPersonalNote(null); }, [id]);
  const view = useMemo(() => (recipe ? applyVariant(recipe, useVariant) : null), [recipe, useVariant]);

  if (loading && !recipe) return <Loading />;
  if (error) return <div className="page"><ErrorBox error={error} onRetry={reload} /></div>;
  if (!recipe) return null;

  const base = view.servings || 1;
  const current = servings ?? base;
  const factor = current / base;
  const canEdit = recipe.perm === 'owner' || recipe.perm === 'edit';
  const images = recipe.image_urls?.length ? recipe.image_urls : [];
  const hasVariant = !!recipe.personal?.variant;

  const toggleFav = async () => {
    setData((r) => ({ ...r, favorite: !r.favorite }));
    await api.put(`/api/recipes/${recipe.id}/favorite`, { favorite: !recipe.favorite });
  };
  const rate = async (r) => {
    const d = await api.put(`/api/recipes/${recipe.id}/rating`, { rating: r });
    setData((x) => ({ ...x, ...d }));
  };
  const duplicate = async () => {
    const d = await api.post(`/api/recipes/${recipe.id}/duplicate`);
    toast(t('Kopie erstellt'));
    navigate(`/recipes/${d.id}/edit`);
  };
  const remove = async () => {
    await api.del(`/api/recipes/${recipe.id}`);
    toast(t('In den Papierkorb verschoben'), { action: { label: t('Rückgängig'), fn: () => api.post(`/api/recipes/${recipe.id}/restore`).then(() => navigate(`/recipes/${recipe.id}`)) } });
    navigate('/recipes');
  };
  const toggleOffline = async () => {
    const offline = !recipe.personal.offline;
    await api.put(`/api/recipes/${recipe.id}/personal`, { offline });
    if (offline) await cacheRecipeOffline(recipe.id);
    setData((r) => ({ ...r, personal: { ...r.personal, offline } }));
    toast(offline ? t('Rezept ist jetzt offline verfügbar') : t('Nicht mehr offline gespeichert'));
  };
  const savePersonalNote = async () => {
    if (personalNote == null) return;
    await api.put(`/api/recipes/${recipe.id}/personal`, { note: personalNote });
    setData((r) => ({ ...r, personal: { ...r.personal, note: personalNote } }));
    setPersonalNote(null);
    toast(t('Notiz gespeichert'));
  };
  const closeDialog = (changed) => { setDialog(null); if (changed) reload(); };

  const facts = [
    recipe.prep_time && { icon: Clock, label: t('Vorbereitung'), value: formatMinutes(recipe.prep_time, t) },
    recipe.cook_time && { icon: Clock, label: t('Kochen/Backen'), value: formatMinutes(recipe.cook_time, t) },
    recipe.rest_time && { icon: Clock, label: t('Ruhezeit'), value: formatMinutes(recipe.rest_time, t) },
    recipe.total_time && { icon: Clock, label: t('Gesamt'), value: formatMinutes(recipe.total_time, t) },
    recipe.difficulty && { icon: Gauge, label: t('Schwierigkeit'), value: t({ easy: 'Einfach', medium: 'Mittel', hard: 'Anspruchsvoll' }[recipe.difficulty]) },
  ].filter(Boolean);

  return (
    <div className="page">
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn ghost small" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/recipes'))}><ChevronLeft size={18} />{t('Zurück')}</button>
        {recipe.__offline && <span className="badge yellow"><CloudOff size={12} />{t('Offline-Kopie')}</span>}
      </div>

      {images.length > 0 && <div className="recipe-hero">
        <img src={images[img]} alt={recipe.title} />
        {images.length > 1 && (
          <>
            <div className="thumbs no-print">
              {images.slice(0, 6).map((u, i) => (
                <button key={u} className={i === img ? 'active' : ''} onClick={() => setImg(i)}><img src={u.replace('.webp', '.thumb.webp')} alt="" /></button>
              ))}
            </div>
            <div className="gallery-nav no-print">
              <button className="btn icon small" onClick={() => setImg((img - 1 + images.length) % images.length)}><ChevronLeft size={18} /></button>
              <button className="btn icon small" onClick={() => setImg((img + 1) % images.length)}><ChevronRight size={18} /></button>
            </div>
          </>
        )}
      </div>}

      <div className="recipe-header">
        <div className="row wrap" style={{ gap: 8 }}>
          {recipe.category && <span className="badge accent">{recipe.category}</span>}
          {recipe.thermomix && <span className="badge green">Thermomix</span>}
          {recipe.group && <span className="badge"><Users size={11} />{recipe.group.name}</span>}
          {!recipe.group && recipe.perm === 'owner' && <span className="badge"><Lock size={11} />{t('Privat')}</span>}
          {recipe.is_public && <span className="badge blue"><Globe size={11} />{t('Öffentlich')}</span>}
          {recipe.perm === 'view' && <span className="badge">{t('Nur ansehen')}</span>}
        </div>
        <h1>{recipe.title}</h1>
        {recipe.description && <p className="muted" style={{ fontSize: '1.08rem', maxWidth: 820, whiteSpace: 'pre-line' }}>{recipe.description}</p>}
        <div className="row wrap" style={{ gap: 14 }}>
          <Stars value={recipe.my_rating || recipe.avg_rating} onChange={rate} />
          <span className="small faint">
            {recipe.avg_rating ? t('Ø {r} aus {n} Bewertungen', { r: recipe.avg_rating, n: recipe.rating_count }) : t('Noch nicht bewertet')}
            {recipe.owner && ` · ${t('von {name}', { name: recipe.owner.name })}`}
          </span>
        </div>
        {facts.length > 0 && (
          <div className="recipe-facts">
            {facts.map((f) => <div className="fact" key={f.label}><f.icon size={20} /><div><span>{f.label}</span><b>{f.value}</b></div></div>)}
          </div>
        )}
        <div className="recipe-actions no-print">
          <Link to={`/recipes/${recipe.id}/cook?servings=${current}${useVariant && hasVariant ? '&variant=1' : ''}`} className="btn primary large cta-cook"><ChefHat size={22} />{t('Kochvorgang starten')}</Link>
          <button className="btn icon" onClick={toggleFav} aria-label={t('Favorit')} style={{ color: recipe.favorite ? 'var(--accent)' : undefined }}><Heart size={20} fill={recipe.favorite ? 'currentColor' : 'none'} /></button>
          <button className="btn" onClick={() => setDialog('plan')}><CalendarPlus size={18} /><span>{t('Planen')}</span></button>
          <button className="btn" onClick={() => setDialog('shop')}><ShoppingCart size={18} /><span>{t('Einkaufen')}</span></button>
          <button className="btn" onClick={() => setDialog('share')}><Share2 size={18} /><span>{t('Teilen')}</span></button>
          <Menu trigger={({ toggle }) => <button className="btn icon" onClick={toggle} aria-label={t('Weitere Aktionen')}><MoreHorizontal size={20} /></button>}>
            {canEdit && <button onClick={() => navigate(`/recipes/${recipe.id}/edit`)}><Pencil size={17} />{t('Bearbeiten')}</button>}
            {canEdit && <button onClick={() => navigate(`/recipes/${recipe.id}/thermomix`)}><Wand2 size={17} />{t('Für Thermomix vorbereiten')}</button>}
            <button onClick={() => navigate(`/recipes/${recipe.id}/variant`)}><UserPen size={17} />{hasVariant ? t('Meine Version bearbeiten') : t('Persönlich anpassen')}</button>
            <button onClick={() => setDialog('books')}><Library size={17} />{t('Zu Rezeptbuch hinzufügen')}</button>
            <button onClick={duplicate}><Copy size={17} />{t('Duplizieren')}</button>
            <button onClick={toggleOffline}>{recipe.personal.offline ? <CloudOff size={17} /> : <Cloud size={17} />}{recipe.personal.offline ? t('Nicht mehr offline speichern') : t('Offline verfügbar machen')}</button>
            <hr />
            <button onClick={() => window.print()}><Printer size={17} />{t('Drucken')}</button>
            <a href={`/api/export?ids=${recipe.id}`}><Download size={17} />{t('Als Datei exportieren')}</a>
            <button onClick={() => navigate(`/recipes/${recipe.id}/history`)}><History size={17} />{t('Änderungsverlauf')}</button>
            {canEdit && <><hr /><button className="danger" onClick={() => setDialog('delete')}><Trash2 size={17} />{t('Löschen')}</button></>}
          </Menu>
        </div>
        {hasVariant && (
          <div className="segmented no-print" style={{ alignSelf: 'flex-start' }}>
            <button className={useVariant ? 'active' : ''} onClick={() => { setUseVariant(true); setServings(null); }}><UserPen size={14} style={{ verticalAlign: -2 }} /> {t('Meine Version')}</button>
            <button className={!useVariant ? 'active' : ''} onClick={() => { setUseVariant(false); setServings(null); }}>{t('Original')}</button>
          </div>
        )}
      </div>

      <div className="recipe-layout">
        <div className="sticky-col">
          <div className="card pad">
            <div className="card-title">
              <h2 style={{ fontSize: '1.25rem' }}>{t('Zutaten')}</h2>
              <div className="servings-ctl no-print">
                <button className="btn ghost icon small" onClick={() => setServings(Math.max(1, Math.round((current - 1) * 2) / 2 || 1))} aria-label="-"><Minus size={16} /></button>
                <b>{current} {view.servings_unit || t('Portionen')}</b>
                <button className="btn ghost icon small" onClick={() => setServings(current + 1)} aria-label="+"><Plus size={16} /></button>
              </div>
            </div>
            {factor !== 1 && <p className="hint" style={{ marginBottom: 8 }}>{t('Mengen umgerechnet von {n} Portionen', { n: base })} · <span className="link" onClick={() => setServings(null)}>{t('zurücksetzen')}</span></p>}
            {view.ingredients.length ? <Ingredients groups={view.ingredients} factor={factor} t={t} /> : <p className="muted">{t('Keine Zutaten angegeben.')}</p>}
          </div>
          {recipe.nutrition && (
            <div className="card pad mt">
              <h3 style={{ marginBottom: 10 }}>{t('Nährwerte pro Portion')}</h3>
              <div className="nutri">
                {[['calories', 'kcal', 'Kalorien'], ['protein', 'g', 'Eiweiß'], ['carbs', 'g', 'Kohlenhydrate'], ['fat', 'g', 'Fett'], ['fiber', 'g', 'Ballaststoffe'], ['sugar', 'g', 'Zucker']]
                  .filter(([k]) => recipe.nutrition[k] != null)
                  .map(([k, u, l]) => <div key={k}><b>{recipe.nutrition[k]}{u !== 'kcal' ? ' ' + u : ''}</b><span>{k === 'calories' ? 'kcal' : t(l)}</span></div>)}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="card pad">
            <h2 style={{ fontSize: '1.25rem', marginBottom: 18 }}>{t('Zubereitung')}</h2>
            {view.steps.length ? (
              <ol className="steps">
                {view.steps.map((s, i) => (
                  <li key={i}>
                    {s.title && <div className="step-title">{s.title}</div>}
                    <div className="step-text">{s.text}</div>
                    {s.timer && !s.tm ? <span className="badge" style={{ marginTop: 8 }}><Timer size={12} />{formatSeconds(s.timer)}</span> : null}
                    <TmBadge tm={s.tm} t={t} />
                  </li>
                ))}
              </ol>
            ) : <p className="muted">{t('Keine Zubereitungsschritte angegeben.')}</p>}
          </div>

          {(recipe.notes || view.variantNotes) && (
            <div className="card pad mt">
              <h3 style={{ marginBottom: 10 }}>{t('Notizen')}</h3>
              {recipe.notes && <div className="notes-box">{recipe.notes}</div>}
              {view.variantNotes && <div className="notes-box mt"><b>{t('Meine Anpassung')}:</b> {view.variantNotes}</div>}
            </div>
          )}

          <div className="card pad mt no-print">
            <h3 style={{ marginBottom: 10 }}><Lock size={15} style={{ verticalAlign: -2 }} /> {t('Meine private Notiz')}</h3>
            <textarea className="input" placeholder={t('Nur für dich sichtbar …')} value={personalNote ?? recipe.personal.note} onChange={(e) => setPersonalNote(e.target.value)} />
            {personalNote != null && <div className="btn-row mt"><button className="btn primary small" onClick={savePersonalNote}>{t('Speichern')}</button><button className="btn small" onClick={() => setPersonalNote(null)}>{t('Verwerfen')}</button></div>}
          </div>

          <div className="card pad mt no-print">
            <h3 style={{ marginBottom: 10 }}>{t('Kochprotokoll')}</h3>
            <CookLog log={recipe.cook_log} recipeId={recipe.id} onChange={reload} />
          </div>

          {(recipe.source_url || recipe.source_note || recipe.tags.length > 0 || recipe.cookbooks.length > 0) && (
            <div className="card pad mt">
              {recipe.tags.length > 0 && <div className="chips" style={{ marginBottom: 12 }}>{recipe.tags.map((tg) => <Link key={tg} to={`/recipes?tag=${encodeURIComponent(tg)}`} className="chip">#{tg}</Link>)}</div>}
              {recipe.cookbooks.length > 0 && <div className="chips" style={{ marginBottom: 12 }}>{recipe.cookbooks.map((c) => <Link key={c.id} to={`/cookbooks/${c.id}`} className="chip"><Library size={13} />{c.name}</Link>)}</div>}
              {recipe.source_url && <p className="small muted"><ExternalLink size={13} style={{ verticalAlign: -2 }} /> {t('Quelle')}: <a className="link" href={recipe.source_url} target="_blank" rel="noreferrer">{new URL(recipe.source_url).hostname}</a></p>}
              {recipe.source_note && <p className="small muted">{recipe.source_note}</p>}
              <p className="tiny faint mt">{t('Zuletzt geändert')}: {formatDateTime(recipe.updated_at, t.lang)}</p>
            </div>
          )}
        </div>
      </div>

      {dialog === 'plan' && <AddToPlanDialog recipe={{ ...recipe, servings: current }} onClose={closeDialog} />}
      {dialog === 'shop' && <AddToShoppingDialog recipe={{ ...recipe, servings: view.servings }} ingredients={useVariant && hasVariant ? view.ingredients : null} servings={current} onClose={closeDialog} />}
      {dialog === 'books' && <CookbookDialog recipe={recipe} onClose={closeDialog} />}
      {dialog === 'share' && <ShareDialog recipe={recipe} onClose={closeDialog} />}
      {dialog === 'delete' && <Confirm title={t('Rezept löschen?')} text={t('Das Rezept wird in den Papierkorb verschoben und kann dort wiederhergestellt werden.')} danger confirmLabel={t('In den Papierkorb')} onConfirm={remove} onClose={() => setDialog(null)} />}
    </div>
  );
}
