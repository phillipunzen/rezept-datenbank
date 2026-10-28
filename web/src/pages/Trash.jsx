import { useState } from 'react';
import { Trash2, RotateCcw } from 'lucide-react';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { useApi, Loading, Empty, ErrorBox, Confirm, useToast, Img } from '../components/ui.jsx';
import { formatDate } from '../lib/format.js';

export default function Trash() {
  const t = useT();
  const toast = useToast();
  const { data, error, loading, reload } = useApi('/api/trash');
  const [confirm, setConfirm] = useState(null);
  return (
    <div className="page narrow">
      <div className="page-head">
        <div><h1>{t('Papierkorb')}</h1><p className="sub">{t('Gelöschte Rezepte kannst du hier wiederherstellen oder endgültig löschen.')}</p></div>
        {data?.items.length > 0 && <button className="btn danger" onClick={() => setConfirm('all')}><Trash2 size={17} />{t('Papierkorb leeren')}</button>}
      </div>
      {loading ? <Loading /> : <ErrorBox error={error} onRetry={reload} />}
      {data?.items.length === 0 && <Empty icon={Trash2} title={t('Der Papierkorb ist leer')} />}
      <div className="stack">
        {data?.items.map((r) => (
          <div key={r.id} className="card row" style={{ padding: 10 }}>
            <div style={{ width: 56, height: 56, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }} className="rcard-img"><Img src={r.thumb_url} iconSize={20} /></div>
            <div style={{ flex: 1 }}><b>{r.title}</b><div className="small muted">{t('Gelöscht am {d}', { d: formatDate(r.deleted_at, t.lang) })}</div></div>
            <button className="btn small" onClick={async () => { await api.post(`/api/recipes/${r.id}/restore`); toast(t('Wiederhergestellt')); reload(); }}><RotateCcw size={15} />{t('Wiederherstellen')}</button>
            <button className="btn small danger icon" onClick={() => setConfirm(r)} aria-label={t('Endgültig löschen')}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
      {confirm && <Confirm title={confirm === 'all' ? t('Papierkorb leeren?') : t('Endgültig löschen?')} danger confirmLabel={t('Endgültig löschen')}
        text={t('Das kann nicht rückgängig gemacht werden.')}
        onConfirm={async () => { if (confirm === 'all') await api.post('/api/trash/empty'); else await api.del(`/api/recipes/${confirm.id}/permanent`); reload(); }} onClose={() => setConfirm(null)} />}
    </div>
  );
}
