import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, RotateCcw, Eye } from 'lucide-react';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { useApi, Loading, ErrorBox, Modal, useToast, Confirm } from '../components/ui.jsx';
import { formatDateTime, formatAmount } from '../lib/format.js';

function diffLines(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  return [...a.filter((x) => !sb.has(x)).map((x) => ({ type: 'del', text: x })), ...b.filter((x) => !sa.has(x)).map((x) => ({ type: 'add', text: x }))];
}
const ingLines = (s) => (s?.ingredients || []).flatMap((g) => g.items.map((i) => `${g.name ? g.name + ': ' : ''}${formatAmount(i.amount, i.unit)} ${i.unit || ''} ${i.name}${i.note ? ', ' + i.note : ''}`.replace(/\s+/g, ' ').trim()));
const stepLines = (s) => (s?.steps || []).map((x) => x.text);

export default function History() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const { id } = useParams();
  const recipe = useApi(`/api/recipes/${id}`);
  const { data, error, loading } = useApi(`/api/recipes/${id}/versions`);
  const [view, setView] = useState(null);
  const [restore, setRestore] = useState(null);

  const open = async (v, idx) => {
    const cur = await api.get(`/api/recipes/${id}/versions/${v.id}`);
    const prevMeta = data.items[idx + 1];
    const prev = prevMeta ? await api.get(`/api/recipes/${id}/versions/${prevMeta.id}`) : null;
    setView({ ...cur, prev: prev?.snapshot });
  };
  if (loading) return <Loading />;
  const canEdit = ['owner', 'edit'].includes(recipe.data?.perm);
  return (
    <div className="page narrow">
      <Link to={`/recipes/${id}`} className="btn ghost small"><ChevronLeft size={18} />{t('Zurück zum Rezept')}</Link>
      <div className="page-head mt"><div><h1>{t('Änderungsverlauf')}</h1><p className="sub">{recipe.data?.title}</p></div></div>
      <ErrorBox error={error} />
      <div className="stack">
        {data?.items.map((v, i) => (
          <div key={v.id} className="card row" style={{ padding: '12px 16px' }}>
            <div style={{ flex: 1 }}>
              <b>{v.note || t('Bearbeitet')}</b>
              <div className="small muted">{formatDateTime(v.created_at, t.lang)} · {v.user || t('Unbekannt')}</div>
            </div>
            {i === 0 && <span className="badge green">{t('Aktuell')}</span>}
            <button className="btn small" onClick={() => open(v, i)}><Eye size={15} />{t('Ansehen')}</button>
            {i > 0 && canEdit && <button className="btn small" onClick={() => setRestore(v)}><RotateCcw size={15} />{t('Wiederherstellen')}</button>}
          </div>
        ))}
      </div>
      {view && (
        <Modal title={`${t('Version vom')} ${formatDateTime(view.created_at, t.lang)}`} onClose={() => setView(null)} wide>
          <h3>{view.snapshot.title}</h3>
          <p className="small muted" style={{ marginBottom: 12 }}>{t('{n} Portionen', { n: view.snapshot.servings })}</p>
          {view.prev && (() => {
            const d = [...diffLines(ingLines(view.prev), ingLines(view.snapshot)), ...diffLines(stepLines(view.prev), stepLines(view.snapshot))];
            const changes = [];
            for (const k of ['title', 'description', 'servings', 'prep_time', 'cook_time', 'category', 'notes']) {
              if (String(view.prev[k] ?? '') !== String(view.snapshot[k] ?? '')) changes.push(k);
            }
            return (
              <div className="card pad" style={{ marginBottom: 14 }}>
                <b>{t('Änderungen gegenüber der vorherigen Version')}</b>
                {!d.length && !changes.length && <p className="small muted">{t('Keine inhaltlichen Änderungen')}</p>}
                {changes.length > 0 && <p className="small">{t('Geänderte Felder')}: {changes.join(', ')}</p>}
                <div className="stack mt" style={{ gap: 4 }}>{d.map((x, i) => <div key={i} className={`small ${x.type === 'add' ? 'diff-add' : 'diff-del'}`} style={{ padding: '3px 8px', borderRadius: 6 }}>{x.type === 'add' ? '+ ' : '− '}{x.text}</div>)}</div>
              </div>
            );
          })()}
          <h4 style={{ marginBottom: 6 }}>{t('Zutaten')}</h4>
          <ul className="small">{ingLines(view.snapshot).map((l, i) => <li key={i}>{l}</li>)}</ul>
          <h4 style={{ margin: '12px 0 6px' }}>{t('Zubereitung')}</h4>
          <ol className="small">{stepLines(view.snapshot).map((l, i) => <li key={i} style={{ marginBottom: 6 }}>{l}</li>)}</ol>
        </Modal>
      )}
      {restore && <Confirm title={t('Version wiederherstellen?')} text={t('Der aktuelle Stand bleibt im Verlauf erhalten.')} confirmLabel={t('Wiederherstellen')}
        onConfirm={async () => { await api.post(`/api/recipes/${id}/versions/${restore.id}/restore`); toast(t('Version wiederhergestellt')); navigate(`/recipes/${id}`); }} onClose={() => setRestore(null)} />}
    </div>
  );
}
