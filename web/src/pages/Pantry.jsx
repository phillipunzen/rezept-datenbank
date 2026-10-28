import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, Plus, Trash2, ChefHat, ShoppingCart, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app.jsx';
import { useT } from '../lib/i18n.js';
import { useApi, Loading, Empty, ErrorBox, useToast, Img, Modal } from '../components/ui.jsx';
import { ListSelect } from '../components/dialogs.jsx';
import { formatAmount, formatDate } from '../lib/format.js';

const CATS = { produce: 'Obst & Gemüse', dairy: 'Milchprodukte & Eier', meat: 'Fleisch & Fisch', bakery: 'Brot & Backwaren', baking: 'Backzutaten', dry: 'Nudeln, Reis & Hülsenfrüchte', spices: 'Gewürze & Brühe', canned: 'Konserven, Öle & Saucen', frozen: 'Tiefkühl', drinks: 'Getränke', other: 'Sonstiges' };

function MissingDialog({ item, onClose }) {
  const t = useT();
  const toast = useToast();
  const [listId, setListId] = useState(undefined);
  const add = async () => {
    let id = listId;
    if (id === 'new') id = (await api.post('/api/shopping', { name: t('Einkaufsliste') })).id;
    await api.post(`/api/shopping/${id}/items`, { items: item.missing.map((m) => ({ name: m.name, amount: m.amount, unit: m.unit })) });
    toast(t('Fehlende Zutaten zur Einkaufsliste hinzugefügt'));
    onClose();
  };
  return (
    <Modal title={t('Fehlende Zutaten einkaufen')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Abbrechen')}</button><button className="btn primary" onClick={add}>{t('Hinzufügen')}</button></>}>
      <p style={{ marginBottom: 10 }}><b>{item.recipe.title}</b></p>
      <ul className="small">{item.missing.map((m, i) => <li key={i}>{formatAmount(m.amount, m.unit)} {m.unit} {m.name}</li>)}</ul>
      <ListSelect value={listId} onChange={setListId} />
    </Modal>
  );
}

export default function Pantry() {
  const t = useT();
  const toast = useToast();
  const { groups } = useApp();
  const [scope, setScope] = useState(() => localStorage.getItem('pantry-scope') || '');
  const q = scope ? `?scope=${scope}` : '?scope=personal';
  const { data, error, loading, reload } = useApi(`/api/pantry${q}`);
  const sugg = useApi(`/api/pantry/suggestions${q}`);
  const [text, setText] = useState('');
  const [bb, setBb] = useState('');
  const [missing, setMissing] = useState(null);
  const add = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await api.post('/api/pantry', { text, best_before: bb || null, group_id: scope || null });
      setText(''); setBb('');
      reload(); sugg.reload();
    } catch (err) { toast(err.message, { type: 'error' }); }
  };
  const remove = async (p) => { await api.del(`/api/pantry/${p.id}`); reload(); sugg.reload(); };
  const grouped = {};
  for (const p of data?.items || []) (grouped[p.category] ||= []).push(p);
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t('Vorratsschrank')}</h1><p className="sub">{t('Was hast du zu Hause? Daraus entstehen Rezeptvorschläge.')}</p></div>
        {groups.length > 0 && (
          <select className="input" style={{ width: 'auto' }} value={scope} onChange={(e) => { setScope(e.target.value); localStorage.setItem('pantry-scope', e.target.value); }}>
            <option value="">{t('Mein Vorrat')}</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
      </div>
      <div className="recipe-layout" style={{ gridTemplateColumns: 'minmax(280px, 420px) 1fr' }}>
        <div>
          <form className="row" onSubmit={add} style={{ marginBottom: 14 }}>
            <input className="input" placeholder={t('z. B. 500 g Nudeln')} value={text} onChange={(e) => setText(e.target.value)} />
            <input className="input" type="date" title={t('Mindestens haltbar bis')} style={{ width: 150 }} value={bb} onChange={(e) => setBb(e.target.value)} />
            <button className="btn primary icon"><Plus size={20} /></button>
          </form>
          {loading && !data ? <Loading /> : <ErrorBox error={error} />}
          {data?.items.length === 0 && <Empty icon={Archive} title={t('Noch nichts im Vorrat')} text={t('Trage ein, was du zu Hause hast – oder verschiebe gekaufte Einträge aus der Einkaufsliste hierher.')} />}
          {Object.keys(CATS).filter((c) => grouped[c]).map((c) => (
            <div className="shop-cat" key={c}>
              <h4>{t(CATS[c])}</h4>
              <div className="shop-items">
                {grouped[c].map((p) => (
                  <div className="shop-item" key={p.id}>
                    <div className="shop-name">
                      {(p.amount != null || p.unit) && <span className="shop-qty">{formatAmount(p.amount, p.unit)} {p.unit}</span>}
                      <b>{p.name}</b>
                      {p.best_before && <div className="shop-src" style={{ color: p.best_before < today ? 'var(--red)' : p.best_before <= soon ? 'var(--yellow)' : undefined }}>
                        {p.best_before <= soon && <AlertTriangle size={11} style={{ verticalAlign: -1 }} />} {t('MHD')} {formatDate(p.best_before, t.lang)}
                      </div>}
                    </div>
                    <button className="btn ghost icon small" onClick={() => remove(p)}><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div>
          <h2 style={{ marginBottom: 12 }}><ChefHat size={22} style={{ verticalAlign: -3 }} /> {t('Was kann ich kochen?')}</h2>
          {sugg.loading && !sugg.data ? <Loading /> : sugg.data?.items.length === 0 ? (
            <p className="muted">{t('Sobald Vorräte eingetragen sind, schlagen wir passende Rezepte vor.')}</p>
          ) : (
            <div className="stack">
              {sugg.data?.items.map((s) => (
                <div key={s.recipe.id} className="card row" style={{ padding: 10, alignItems: 'flex-start' }}>
                  <Link to={`/recipes/${s.recipe.id}`} className="rcard-img" style={{ width: 84, height: 84, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}><Img src={s.recipe.thumb_url} iconSize={22} /></Link>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Link to={`/recipes/${s.recipe.id}`}><b>{s.recipe.title}</b></Link>
                    <div className="progress" style={{ margin: '6px 0', height: 6 }}><div style={{ width: `${Math.round(s.score * 100)}%`, background: s.score === 1 ? 'var(--green)' : undefined }} /></div>
                    <div className="tiny muted">{t('Vorhanden')}: {s.have.join(', ')}</div>
                    {s.missing.length > 0
                      ? <div className="tiny" style={{ color: 'var(--red)' }}>{t('Fehlt')}: {s.missing.map((m) => m.name).join(', ')}</div>
                      : <div className="tiny" style={{ color: 'var(--green)', fontWeight: 700 }}>{t('Alles da!')}</div>}
                  </div>
                  {s.missing.length > 0 && <button className="btn small" title={t('Fehlende Zutaten einkaufen')} onClick={() => setMissing(s)}><ShoppingCart size={15} /></button>}
                </div>
              ))}
            </div>
          )}
          <p className="hint mt">{t('Salz, Pfeffer, Öl, Zucker und Wasser gelten als immer vorhanden.')}</p>
        </div>
      </div>
      {missing && <MissingDialog item={missing} onClose={() => setMissing(null)} />}
    </div>
  );
}
