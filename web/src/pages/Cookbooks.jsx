import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Library, Plus, Users, Pencil, Trash2, ChevronLeft, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { useApi, Loading, Empty, ErrorBox, Modal, Confirm, useToast } from '../components/ui.jsx';
import { ScopeSelect, RecipePicker } from '../components/dialogs.jsx';
import RecipeCard from '../components/RecipeCard.jsx';

const COLORS = ['#c2410c', '#b45309', '#15803d', '#0e7490', '#1d4ed8', '#7c3aed', '#be185d', '#57534e'];

function BookForm({ book, onClose }) {
  const t = useT();
  const toast = useToast();
  const [f, setF] = useState({ name: book?.name || '', description: book?.description || '', color: book?.color || COLORS[0], group_id: book?.group_id || null });
  const save = async () => {
    try {
      if (book) await api.put(`/api/cookbooks/${book.id}`, f); else await api.post('/api/cookbooks', f);
      onClose(true);
    } catch (e) { toast(e.message, { type: 'error' }); }
  };
  return (
    <Modal title={book ? t('Rezeptbuch bearbeiten') : t('Neues Rezeptbuch')} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>{t('Abbrechen')}</button><button className="btn primary" disabled={!f.name.trim()} onClick={save}>{t('Speichern')}</button></>}>
      <div className="field"><label>{t('Name')}</label><input className="input" autoFocus placeholder={t('z. B. Lieblingsrezepte, Backen, Schnelle Küche')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div className="field"><label>{t('Beschreibung')}</label><textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
      <div className="field"><label>{t('Farbe')}</label><div className="row">{COLORS.map((c) => <button key={c} onClick={() => setF({ ...f, color: c })} style={{ width: 30, height: 30, borderRadius: '50%', background: c, border: f.color === c ? '3px solid var(--text)' : '0', cursor: 'pointer' }} />)}</div></div>
      <ScopeSelect value={f.group_id} onChange={(g) => setF({ ...f, group_id: g })} label={t('Gemeinsam pflegen mit')} />
    </Modal>
  );
}

export default function Cookbooks() {
  const t = useT();
  const { data, error, loading, reload } = useApi('/api/cookbooks');
  const [form, setForm] = useState(false);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t('Rezeptbücher')}</h1><p className="sub">{t('Sortiere Rezepte in eigene Bücher – ein Rezept kann in mehreren Büchern stehen.')}</p></div>
        <button className="btn primary" onClick={() => setForm(true)}><Plus size={18} />{t('Neues Rezeptbuch')}</button>
      </div>
      {loading ? <Loading /> : <ErrorBox error={error} onRetry={reload} />}
      {data?.items.length === 0 && <Empty icon={Library} title={t('Noch keine Rezeptbücher')} text={t('Zum Beispiel „Lieblingsrezepte“, „Backen“, „Schnelle Küche“ oder „Thermomix“.')}><button className="btn primary" onClick={() => setForm(true)}><Plus size={18} />{t('Neues Rezeptbuch')}</button></Empty>}
      <div className="recipe-grid">
        {data?.items.map((b) => (
          <Link key={b.id} to={`/cookbooks/${b.id}`} className="rcard">
            <div className="rcard-img" style={{ background: b.color || 'var(--accent)', display: 'grid', gridTemplateColumns: b.covers.length > 1 ? '1fr 1fr' : '1fr', gap: 2 }}>
              {b.covers.length ? b.covers.map((c) => <img key={c} src={c} alt="" style={{ height: '100%', minHeight: 0 }} />) : <div className="placeholder" style={{ background: 'transparent', color: 'rgba(255,255,255,.8)' }}><Library size={44} /></div>}
            </div>
            <div className="rcard-body" style={{ borderTop: `4px solid ${b.color || 'var(--accent)'}` }}>
              <div className="rcard-title">{b.name}</div>
              <div className="rcard-meta"><span>{t('{n} Rezepte', { n: b.recipe_count })}</span>{b.group_name && <span><Users size={12} />{b.group_name}</span>}</div>
            </div>
          </Link>
        ))}
      </div>
      {form && <BookForm onClose={(c) => { setForm(false); if (c) reload(); }} />}
    </div>
  );
}

export function CookbookDetail() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const { id } = useParams();
  const book = useApi(`/api/cookbooks/${id}`);
  const { data, loading, reload, setData } = useApi(`/api/recipes?cookbook=${id}&limit=200&sort=title`);
  const [dialog, setDialog] = useState(null);
  if (book.error) return <div className="page"><ErrorBox error={book.error} /></div>;
  if (!book.data) return <Loading />;
  const b = book.data;
  return (
    <div className="page">
      <Link to="/cookbooks" className="btn ghost small"><ChevronLeft size={18} />{t('Rezeptbücher')}</Link>
      <div className="page-head mt" style={{ borderLeft: `6px solid ${b.color || 'var(--accent)'}`, paddingLeft: 16 }}>
        <div>
          <h1>{b.name}</h1>
          <p className="sub">{b.description || ''}{b.group && <> · <Users size={13} style={{ verticalAlign: -2 }} /> {b.group.name}</>}</p>
        </div>
        {b.can_edit && (
          <div className="btn-row">
            <button className="btn" onClick={() => setDialog('add')}><Plus size={18} />{t('Rezepte hinzufügen')}</button>
            <button className="btn icon" onClick={() => setDialog('edit')}><Pencil size={18} /></button>
            <button className="btn icon danger" onClick={() => setDialog('delete')}><Trash2 size={18} /></button>
          </div>
        )}
      </div>
      {loading && !data ? <Loading /> : data?.items.length === 0 ? <Empty icon={Library} title={t('Dieses Rezeptbuch ist noch leer')} text={t('Füge Rezepte hinzu – hier oder über „Zu Rezeptbuch hinzufügen“ in einem Rezept.')} /> : (
        <div className="recipe-grid">
          {data?.items.map((r) => (
            <div key={r.id} style={{ position: 'relative' }}>
              <RecipeCard recipe={r} onFavorite={(rid, fav) => setData((d) => ({ ...d, items: d.items.map((x) => (x.id === rid ? { ...x, favorite: fav } : x)) }))} />
              {b.can_edit && <button className="btn icon small" style={{ position: 'absolute', bottom: 8, right: 8 }} title={t('Aus Rezeptbuch entfernen')} onClick={async () => { await api.del(`/api/cookbooks/${id}/recipes/${r.id}`); reload(); }}><X size={15} /></button>}
            </div>
          ))}
        </div>
      )}
      {dialog === 'edit' && <BookForm book={b} onClose={(c) => { setDialog(null); if (c) book.reload(); }} />}
      {dialog === 'delete' && <Confirm title={t('Rezeptbuch löschen?')} text={t('Die Rezepte selbst bleiben erhalten.')} danger confirmLabel={t('Löschen')} onConfirm={async () => { await api.del(`/api/cookbooks/${id}`); navigate('/cookbooks'); }} onClose={() => setDialog(null)} />}
      {dialog === 'add' && <RecipePicker title={t('Rezept hinzufügen')} onClose={() => setDialog(null)} onPick={async (r) => {
        if (!r.id) return;
        try { await api.post(`/api/cookbooks/${id}/recipes`, { recipe_id: r.id }); toast(t('„{t}“ hinzugefügt', { t: r.title })); reload(); } catch (e) { toast(e.message, { type: 'error' }); }
      }} />}
    </div>
  );
}
