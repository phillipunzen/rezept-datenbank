import { Link, useNavigate } from 'react-router-dom';
import { Search, Plus, CalendarDays, ShoppingCart, ChefHat, Heart, History, Sparkles, Utensils } from 'lucide-react';
import { useApp } from '../lib/app.jsx';
import { useT } from '../lib/i18n.js';
import { useApi, Loading, ErrorBox } from '../components/ui.jsx';
import RecipeCard from '../components/RecipeCard.jsx';
import { isoDate, formatDate } from '../lib/format.js';

const MEAL_LABEL = { breakfast: 'Frühstück', lunch: 'Mittagessen', dinner: 'Abendessen', snack: 'Snack' };

export default function HomePage() {
  const t = useT();
  const { user } = useApp();
  const navigate = useNavigate();
  const { data, error, loading, reload, setData } = useApi(`/api/home?today=${isoDate(new Date())}`);
  const hour = new Date().getHours();
  const greet = hour < 11 ? t('Guten Morgen') : hour < 17 ? t('Hallo') : t('Guten Abend');
  const onFav = (id, fav) => setData((d) => ({ ...d, favorites: fav ? d.favorites : d.favorites.filter((r) => r.id !== id), recent: d.recent.map((r) => (r.id === id ? { ...r, favorite: fav } : r)) }));

  const quick = [
    { to: '/recipes', icon: Search, label: t('Rezepte suchen'), color: 'var(--blue)', bg: 'var(--blue-soft)' },
    { to: '/import', icon: Plus, label: t('Rezept importieren'), color: 'var(--accent)', bg: 'var(--accent-soft)' },
    { to: '/plan', icon: CalendarDays, label: t('Wochenplan'), color: 'var(--green)', bg: 'var(--green-soft)' },
    { to: '/shopping', icon: ShoppingCart, label: t('Einkaufsliste'), color: 'var(--yellow)', bg: 'var(--yellow-soft)' },
  ];

  return (
    <div className="page">
      <div className="hero-greeting">
        <div>
          <h1>{greet}, {user?.display_name?.split(' ')[0]}!</h1>
          <p className="muted" style={{ marginTop: 6 }}>{formatDate(new Date(), t.lang, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </div>
      <div className="quick">
        {quick.map((q) => (
          <Link key={q.to} to={q.to}>
            <span className="ico" style={{ background: q.bg, color: q.color }}><q.icon size={22} /></span>
            {q.label}
          </Link>
        ))}
      </div>
      {loading && !data ? <Loading /> : <ErrorBox error={error} onRetry={reload} />}
      {data && (
        <>
          <div className="section-head"><h2>{t('Heute geplant')}</h2><Link to="/plan" className="link small">{t('Zum Wochenplan')}</Link></div>
          {data.meals.length ? (
            <div className="today-meals">
              {data.meals.map((m) => (
                <Link key={m.id} to={m.recipe_id ? `/recipes/${m.recipe_id}` : '/plan'} className="today-meal">
                  {m.image_url ? <img src={m.image_url} alt="" /> : <div className="noimg" />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tiny faint" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>{t(MEAL_LABEL[m.meal])}</div>
                    <div style={{ fontWeight: 650 }}>{m.title}</div>
                    {m.servings && <div className="tiny muted">{t('{n} Portionen', { n: m.servings })}</div>}
                  </div>
                  {m.recipe_id && <button className="btn small primary icon" aria-label={t('Kochvorgang starten')} onClick={(e) => { e.preventDefault(); navigate(`/recipes/${m.recipe_id}/cook?servings=${m.servings || ''}`); }}><ChefHat size={16} /></button>}
                </Link>
              ))}
            </div>
          ) : (
            <div className="card pad row" style={{ gap: 14 }}>
              <Utensils size={28} className="faint" />
              <div style={{ flex: 1 }}>
                <b>{t('Für heute ist noch nichts geplant.')}</b>
                <div className="small muted">{t('Plane deine Mahlzeiten im Wochenplan – mit Vorschlägen aus deinen Rezepten.')}</div>
              </div>
              <Link to="/plan" className="btn small">{t('Planen')}</Link>
            </div>
          )}

          <div className="section-head"><h2><Heart size={20} style={{ verticalAlign: -2, color: 'var(--accent)' }} /> {t('Favoriten')}</h2><Link to="/recipes?favorites=1" className="link small">{t('Alle anzeigen')}</Link></div>
          {data.favorites.length ? (
            <div className="hscroll">{data.favorites.map((r) => <RecipeCard key={r.id} recipe={r} onFavorite={onFav} />)}</div>
          ) : <p className="muted">{t('Markiere Rezepte mit dem Herz, um sie hier zu sehen.')}</p>}

          <div className="section-head"><h2><History size={20} style={{ verticalAlign: -2 }} /> {t('Zuletzt gekocht')}</h2></div>
          {data.recent.length ? (
            <div className="hscroll">{data.recent.map((r) => <RecipeCard key={r.id} recipe={r} onFavorite={onFav} />)}</div>
          ) : <p className="muted">{t('Starte den Kochmodus in einem Rezept – danach erscheint es hier.')}</p>}

          {data.latest.length > 0 && (
            <>
              <div className="section-head"><h2><Sparkles size={20} style={{ verticalAlign: -2 }} /> {t('Neu im Rezeptbuch')}</h2><Link to="/recipes?sort=created" className="link small">{t('Alle anzeigen')}</Link></div>
              <div className="hscroll">{data.latest.map((r) => <RecipeCard key={r.id} recipe={r} />)}</div>
            </>
          )}
          {data.recipe_count === 0 && (
            <div className="card pad mt-lg center">
              <h3>{t('Dein Rezeptbuch ist noch leer')}</h3>
              <p className="muted mt">{t('Füge dein erstes Rezept hinzu – per Hand, per Link, per Foto oder aus Tandoor.')}</p>
              <Link to="/import" className="btn primary mt"><Plus size={18} />{t('Rezept hinzufügen')}</Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
