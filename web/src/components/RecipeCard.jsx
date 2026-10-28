import { Link } from 'react-router-dom';
import { Heart, Clock, Star, Users, Globe } from 'lucide-react';
import { Img } from './ui.jsx';
import { formatMinutes } from '../lib/format.js';
import { useT } from '../lib/i18n.js';
import { api } from '../lib/api.js';

export default function RecipeCard({ recipe, to, onFavorite, compact }) {
  const t = useT();
  const toggleFav = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const fav = !recipe.favorite;
    onFavorite?.(recipe.id, fav);
    await api.put(`/api/recipes/${recipe.id}/favorite`, { favorite: fav }).catch(() => onFavorite?.(recipe.id, !fav));
  };
  return (
    <Link to={to || `/recipes/${recipe.id}`} className={`rcard ${compact ? 'compact' : ''}`}>
      <div className="rcard-img">
        <Img src={recipe.thumb_url} alt="" />
        {!compact && (
          <div className="rcard-badges">
            {recipe.thermomix && <span className="badge">TM</span>}
            {recipe.group_id && <span className="badge"><Users size={11} /></span>}
            {recipe.is_public && <span className="badge"><Globe size={11} /></span>}
          </div>
        )}
        {onFavorite && !compact && (
          <button className="rcard-fav" onClick={toggleFav} aria-label={t('Favorit')}>
            <Heart size={18} fill={recipe.favorite ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
      <div className="rcard-body">
        <div className="rcard-title">{recipe.title}</div>
        <div className="rcard-meta">
          {recipe.total_time ? <span><Clock size={13} />{formatMinutes(recipe.total_time, t)}</span> : null}
          {recipe.avg_rating ? <span><Star size={13} fill="currentColor" style={{ color: '#e3a008' }} />{Number(recipe.avg_rating).toFixed(1)}</span> : null}
          {recipe.category && <span>{recipe.category}</span>}
        </div>
      </div>
    </Link>
  );
}
