import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Search, Globe, Clock, Users, Printer, LogIn } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app.jsx';
import { useT, LangContext, detectLang } from '../lib/i18n.js';
import { Loading, Empty, ErrorBox, useDebounced, Img } from '../components/ui.jsx';
import RecipeCard from '../components/RecipeCard.jsx';
import { Ingredients, TmBadge } from './RecipeDetail.jsx';
import { formatMinutes, formatSeconds } from '../lib/format.js';

function PublicShell({ children, embedded }) {
  const t = useT();
  const { user } = useApp();
  if (embedded) return children;
  return (
    <>
      <div className="public-top no-print">
        <Link to="/p" className="brand" style={{ padding: 0 }}><img src="/icon.svg" alt="" />{t('Rezeptbuch')}</Link>
        {user ? <Link to="/" className="btn small">{t('Zur App')}</Link> : <Link to="/login" className="btn small"><LogIn size={16} />{t('Anmelden')}</Link>}
      </div>
      {children}
    </>
  );
}

function WithLang({ children }) {
  const { user, lang } = useApp();
  return <LangContext.Provider value={user ? lang : (localStorage.getItem('lang') || detectLang())}>{children}</LangContext.Provider>;
}

function List({ embedded }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const dq = useDebounced(q, 300);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.get(`/api/public/recipes?q=${encodeURIComponent(dq)}&category=${encodeURIComponent(cat)}&limit=60`).then(setData).catch(setError);
  }, [dq, cat]);
  return (
    <PublicShell embedded={embedded}>
      <div className="page">
        <div className="page-head"><div><h1><Globe size={30} style={{ verticalAlign: -4 }} /> {t('Öffentliche Rezepte')}</h1><p className="sub">{t('Rezepte, die Mitglieder ausdrücklich veröffentlicht haben.')}</p></div></div>
        <div style={{ position: 'relative', marginBottom: 14 }}>
          <Search size={18} style={{ position: 'absolute', left: 13, top: 12, color: 'var(--text-faint)' }} />
          <input className="input" style={{ paddingLeft: 40 }} placeholder={t('Rezepte durchsuchen …')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {data?.categories?.length > 0 && (
          <div className="chips scroll" style={{ marginBottom: 18 }}>
            <button className={`chip ${!cat ? 'active' : ''}`} onClick={() => setCat('')}>{t('Alle')}</button>
            {data.categories.map((c) => <button key={c} className={`chip ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>{c}</button>)}
          </div>
        )}
        <ErrorBox error={error} />
        {!data ? <Loading /> : data.items.length === 0 ? <Empty icon={Globe} title={t('Noch keine öffentlichen Rezepte')} /> : (
          <div className="recipe-grid">{data.items.map((r) => <RecipeCard key={r.id} recipe={r} to={`/p/${r.slug}`} />)}</div>
        )}
      </div>
    </PublicShell>
  );
}

function RecipeView({ shared }) {
  const t = useT();
  const { slug, token } = useParams();
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  const [servings, setServings] = useState(null);
  useEffect(() => {
    api.get(shared ? `/api/public/shared/${token}` : `/api/public/recipes/${slug}`).then((d) => { setR(d); document.title = `${d.title} – Rezeptbuch`; }).catch(setError);
    return () => { document.title = 'Rezeptbuch'; };
  }, [slug, token, shared]);
  if (error) return <PublicShell><div className="page narrow"><ErrorBox error={error} /></div></PublicShell>;
  if (!r) return <PublicShell><Loading /></PublicShell>;
  const current = servings || r.servings;
  return (
    <PublicShell>
      <div className="page">
        <div className="recipe-hero">{r.image_url ? <img src={r.image_url} alt={r.title} /> : <Img src={null} iconSize={64} />}</div>
        <div className="recipe-header">
          {r.category && <span className="badge accent" style={{ alignSelf: 'flex-start' }}>{r.category}</span>}
          <h1>{r.title}</h1>
          {r.description && <p className="muted" style={{ fontSize: '1.08rem', whiteSpace: 'pre-line' }}>{r.description}</p>}
          <div className="recipe-facts">
            {r.total_time && <div className="fact"><Clock size={20} /><div><span>{t('Gesamt')}</span><b>{formatMinutes(r.total_time, t)}</b></div></div>}
            <div className="fact"><Users size={20} /><div><span>{t('Portionen')}</span><b>{r.servings}</b></div></div>
            {r.author && <div className="fact"><div><span>{t('Von')}</span><b>{r.author}</b></div></div>}
          </div>
          <div className="no-print"><button className="btn" onClick={() => window.print()}><Printer size={17} />{t('Drucken')}</button></div>
        </div>
        <div className="recipe-layout">
          <div className="card pad">
            <div className="card-title">
              <h2 style={{ fontSize: '1.25rem' }}>{t('Zutaten')}</h2>
              <div className="servings-ctl no-print">
                <button className="btn ghost icon small" onClick={() => setServings(Math.max(1, current - 1))}>−</button>
                <b>{current} {r.servings_unit || t('Portionen')}</b>
                <button className="btn ghost icon small" onClick={() => setServings(current + 1)}>+</button>
              </div>
            </div>
            <Ingredients groups={r.ingredients} factor={current / (r.servings || 1)} t={t} />
          </div>
          <div className="card pad">
            <h2 style={{ fontSize: '1.25rem', marginBottom: 18 }}>{t('Zubereitung')}</h2>
            <ol className="steps">
              {r.steps.map((s, i) => (
                <li key={i}>
                  {s.title && <div className="step-title">{s.title}</div>}
                  <div className="step-text">{s.text}</div>
                  {s.timer && !s.tm ? <span className="badge" style={{ marginTop: 8 }}>{formatSeconds(s.timer)}</span> : null}
                  <TmBadge tm={s.tm} t={t} />
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}

export default function PublicList({ embedded }) {
  return embedded ? <List embedded /> : <WithLang><List /></WithLang>;
}
export function PublicRecipe({ shared }) {
  return <WithLang><RecipeView shared={shared} /></WithLang>;
}
