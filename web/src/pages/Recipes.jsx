import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Plus, SlidersHorizontal, BookOpen, Heart, X, Download } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app.jsx';
import { useT } from '../lib/i18n.js';
import { Loading, Empty, ErrorBox, useDebounced, useApi } from '../components/ui.jsx';
import RecipeCard from '../components/RecipeCard.jsx';

export default function Recipes() {
  const t = useT();
  const { groups } = useApp();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const dq = useDebounced(q, 300);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const meta = useApi('/api/recipes/meta');

  const p = Object.fromEntries(params.entries());
  const setP = (k, v) => {
    const next = new URLSearchParams(params);
    if (v == null || v === '' || v === false) next.delete(k); else next.set(k, v);
    setParams(next, { replace: true });
  };

  useEffect(() => { if ((params.get('q') || '') !== dq) setP('q', dq); /* eslint-disable-next-line */ }, [dq]);

  const filterKey = params.toString();
  const load = (n) => {
    setLoading(true);
    const qs = new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(filterKey).entries()), page: String(n), limit: '48' });
    return api.get(`/api/recipes?${qs}`).then((d) => {
      setTotal(d.total);
      setPage(n);
      setItems((prev) => (n === 1 ? d.items : [...prev, ...d.items]));
      setError(null);
    }).catch(setError).finally(() => setLoading(false));
  };
  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [filterKey]);

  const onFav = (id, fav) => setItems((list) => list.map((r) => (r.id === id ? { ...r, favorite: fav } : r)));
  const activeFilters = ['category', 'tag', 'thermomix', 'max_time', 'min_rating'].filter((k) => p[k]).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('Rezepte')}</h1>
          <p className="sub">{t('{n} Rezepte', { n: total })}</p>
        </div>
        <div className="btn-row">
          <a className="btn" href="/api/export" title={t('Alle Rezepte exportieren')}><Download size={18} /><span className="hide-sm">{t('Export')}</span></a>
          <Link to="/import" className="btn primary"><Plus size={18} />{t('Rezept hinzufügen')}</Link>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={18} style={{ position: 'absolute', left: 13, top: 12, color: 'var(--text-faint)' }} />
          <input className="input" style={{ paddingLeft: 40, minHeight: 44 }} placeholder={t('Suche nach Titel, Zutat, Tag …')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className={`btn ${activeFilters ? 'primary' : ''}`} onClick={() => setShowFilters((s) => !s)}>
          <SlidersHorizontal size={18} />{activeFilters ? activeFilters : ''}
        </button>
      </div>

      <div className="chips scroll" style={{ marginBottom: 14 }}>
        <button className={`chip ${!p.scope && !p.favorites ? 'active' : ''}`} onClick={() => { setP('scope', ''); setP('favorites', ''); }}>{t('Alle')}</button>
        <button className={`chip ${p.favorites ? 'active' : ''}`} onClick={() => setP('favorites', p.favorites ? '' : '1')}><Heart size={14} />{t('Favoriten')}</button>
        <button className={`chip ${p.scope === 'mine' ? 'active' : ''}`} onClick={() => setP('scope', p.scope === 'mine' ? '' : 'mine')}>{t('Privat')}</button>
        <button className={`chip ${p.scope === 'shared' ? 'active' : ''}`} onClick={() => setP('scope', p.scope === 'shared' ? '' : 'shared')}>{t('Mit mir geteilt')}</button>
        {groups.map((g) => (
          <button key={g.id} className={`chip ${p.scope === String(g.id) ? 'active' : ''}`} onClick={() => setP('scope', p.scope === String(g.id) ? '' : String(g.id))}>{g.name}</button>
        ))}
      </div>

      {showFilters && (
        <div className="card pad" style={{ marginBottom: 18 }}>
          <div className="grid-4">
            <div className="field">
              <label>{t('Kategorie')}</label>
              <select className="input" value={p.category || ''} onChange={(e) => setP('category', e.target.value)}>
                <option value="">{t('Alle')}</option>
                {meta.data?.categories.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
              </select>
            </div>
            <div className="field">
              <label>{t('Maximale Zeit')}</label>
              <select className="input" value={p.max_time || ''} onChange={(e) => setP('max_time', e.target.value)}>
                <option value="">{t('Egal')}</option>
                {[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>≤ {m} {t('Min.')}</option>)}
              </select>
            </div>
            <div className="field">
              <label>{t('Bewertung')}</label>
              <select className="input" value={p.min_rating || ''} onChange={(e) => setP('min_rating', e.target.value)}>
                <option value="">{t('Egal')}</option>
                {[3, 4, 5].map((m) => <option key={m} value={m}>≥ {m} ★</option>)}
              </select>
            </div>
            <div className="field">
              <label>{t('Sortierung')}</label>
              <select className="input" value={p.sort || ''} onChange={(e) => setP('sort', e.target.value)}>
                <option value="">{t('Zuletzt geändert')}</option>
                <option value="created">{t('Neueste')}</option>
                <option value="title">{t('Titel A–Z')}</option>
                <option value="rating">{t('Beste Bewertung')}</option>
                <option value="cooked">{t('Zuletzt gekocht')}</option>
                <option value="time">{t('Schnellste')}</option>
              </select>
            </div>
          </div>
          <label className="switch"><input type="checkbox" checked={!!p.thermomix} onChange={(e) => setP('thermomix', e.target.checked ? '1' : '')} />{t('Nur Thermomix-Rezepte')}</label>
          {meta.data?.tags.length > 0 && (
            <>
              <div className="label mt">{t('Tags')}</div>
              <div className="chips mt" style={{ marginTop: 8 }}>
                {meta.data.tags.slice(0, 40).map((tg) => (
                  <button key={tg.name} className={`chip ${p.tag === tg.name ? 'active' : ''}`} onClick={() => setP('tag', p.tag === tg.name ? '' : tg.name)}>#{tg.name}</button>
                ))}
              </div>
            </>
          )}
          {activeFilters > 0 && (
            <button className="btn ghost small mt" onClick={() => ['category', 'tag', 'thermomix', 'max_time', 'min_rating'].forEach((k) => setP(k, ''))}><X size={15} />{t('Filter zurücksetzen')}</button>
          )}
        </div>
      )}

      <ErrorBox error={error} />
      {items.length > 0 && (
        <div className="recipe-grid">
          {items.map((r) => <RecipeCard key={r.id} recipe={r} onFavorite={onFav} />)}
        </div>
      )}
      {loading && <Loading />}
      {!loading && !items.length && !error && (
        <Empty icon={BookOpen} title={dq || activeFilters ? t('Keine passenden Rezepte') : t('Noch keine Rezepte')} text={dq || activeFilters ? t('Probiere andere Suchbegriffe oder Filter.') : t('Lege dein erstes Rezept an oder importiere eins.')}>
          <Link to="/import" className="btn primary"><Plus size={18} />{t('Rezept hinzufügen')}</Link>
        </Empty>
      )}
      {!loading && items.length < total && (
        <div className="center mt-lg"><button className="btn" onClick={() => load(page + 1)}>{t('Mehr laden')}</button></div>
      )}
    </div>
  );
}
