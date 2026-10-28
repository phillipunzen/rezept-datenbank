import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ShoppingCart, Plus, Check, Trash2, MoreHorizontal, Users, RefreshCw, Home as HomeIcon, Archive, Pencil, ChevronLeft, X, Link2, AlertTriangle,
} from 'lucide-react';
import { api, onServerEvent } from '../lib/api.js';
import { useApp } from '../lib/app.jsx';
import { useT } from '../lib/i18n.js';
import { useApi, Loading, Empty, ErrorBox, Modal, Menu, Confirm, useToast, Alert } from '../components/ui.jsx';
import { ScopeSelect } from '../components/dialogs.jsx';
import { formatAmount, formatDateTime } from '../lib/format.js';
import { parseLine } from '../lib/parse.js';

const CATS = { produce: 'Obst & Gemüse', dairy: 'Milchprodukte & Eier', meat: 'Fleisch & Fisch', bakery: 'Brot & Backwaren', baking: 'Backzutaten', dry: 'Nudeln, Reis & Hülsenfrüchte', spices: 'Gewürze & Brühe', canned: 'Konserven, Öle & Saucen', frozen: 'Tiefkühl', drinks: 'Getränke', other: 'Sonstiges' };
const CAT_ORDER = Object.keys(CATS);

export default function ShoppingLists() {
  const t = useT();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi('/api/shopping');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', group_id: null });

  useEffect(() => onServerEvent((ev) => ev.type === 'shopping' && reload()), [reload]);
  useEffect(() => {
    if (data?.items?.length === 1 && !data.__offline && sessionStorage.getItem('shop-auto') !== '1') {
      sessionStorage.setItem('shop-auto', '1');
      navigate(`/shopping/${data.items[0].id}`, { replace: true });
    }
  }, [data, navigate]);

  const create = async () => {
    const d = await api.post('/api/shopping', { name: form.name || t('Einkaufsliste'), group_id: form.group_id });
    navigate(`/shopping/${d.id}`);
  };

  return (
    <div className="page narrow">
      <div className="page-head">
        <div><h1>{t('Einkaufslisten')}</h1><p className="sub">{t('Gemeinsam einkaufen – Änderungen erscheinen sofort bei allen.')}</p></div>
        <button className="btn primary" onClick={() => setCreating(true)}><Plus size={18} />{t('Neue Liste')}</button>
      </div>
      {loading && !data ? <Loading /> : <ErrorBox error={error} onRetry={reload} />}
      {data?.items.length === 0 && <Empty icon={ShoppingCart} title={t('Noch keine Einkaufsliste')} text={t('Lege eine Liste an oder übernimm Zutaten direkt aus einem Rezept oder dem Wochenplan.')}><button className="btn primary" onClick={() => setCreating(true)}><Plus size={18} />{t('Neue Liste')}</button></Empty>}
      <div className="stack">
        {data?.items.map((l) => (
          <Link key={l.id} to={`/shopping/${l.id}`} className="card list-tile">
            <span className="ico"><ShoppingCart size={22} /></span>
            <div style={{ flex: 1 }}>
              <b>{l.name}</b>
              <div className="small muted">{t('{a} offen · {b} gesamt', { a: l.open_count, b: l.total_count })}</div>
            </div>
            {l.group_name && <span className="badge"><Users size={11} />{l.group_name}</span>}
          </Link>
        ))}
      </div>
      {creating && (
        <Modal title={t('Neue Einkaufsliste')} onClose={() => setCreating(false)} footer={<><button className="btn" onClick={() => setCreating(false)}>{t('Abbrechen')}</button><button className="btn primary" onClick={create}>{t('Anlegen')}</button></>}>
          <div className="field"><label>{t('Name')}</label><input className="input" autoFocus placeholder={t('Einkaufsliste')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <ScopeSelect value={form.group_id} onChange={(g) => setForm({ ...form, group_id: g })} label={t('Teilen mit')} />
        </Modal>
      )}
    </div>
  );
}

function ItemEditor({ item, onSave, onDelete, onClose }) {
  const t = useT();
  const [f, setF] = useState({ name: item.name, amount: item.amount ?? '', unit: item.unit, note: item.note, category: item.category });
  return (
    <Modal title={t('Eintrag bearbeiten')} onClose={onClose} footer={<>
      <button className="btn danger" onClick={onDelete}><Trash2 size={16} />{t('Löschen')}</button>
      <span className="spacer" />
      <button className="btn" onClick={onClose}>{t('Abbrechen')}</button>
      <button className="btn primary" onClick={() => onSave(f)}>{t('Speichern')}</button>
    </>}>
      <div className="field"><label>{t('Name')}</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div className="grid-2">
        <div className="field"><label>{t('Menge')}</label><input className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
        <div className="field"><label>{t('Einheit')}</label><input className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></div>
      </div>
      <div className="field"><label>{t('Notiz')}</label><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
      <div className="field"><label>{t('Abteilung')}</label>
        <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          {CAT_ORDER.map((c) => <option key={c} value={c}>{t(CATS[c])}</option>)}
        </select>
      </div>
      {item.sources?.filter((s) => s.type === 'recipe').length > 0 && (
        <p className="small muted">{t('Aus')}: {[...new Set(item.sources.filter((s) => s.type === 'recipe').map((s) => s.title))].join(', ')}</p>
      )}
    </Modal>
  );
}

function HaDialog({ list, onClose }) {
  const t = useT();
  const toast = useToast();
  const { data, error, loading } = useApi('/api/ha/entities');
  const [busy, setBusy] = useState(false);
  const linked = new Set(list.links.map((l) => l.entity_id));
  const link = async (entity) => {
    setBusy(true);
    try { await api.post(`/api/shopping/${list.id}/links`, { entity_id: entity }); toast(t('Verknüpft und abgeglichen')); onClose(true); }
    catch (e) { toast(e.message, { type: 'error' }); } finally { setBusy(false); }
  };
  return (
    <Modal title={t('Mit Home Assistant verknüpfen')} onClose={() => onClose()}>
      <p className="small muted" style={{ marginBottom: 12 }}>{t('Einträge werden in beide Richtungen abgeglichen: Neue Einträge hier erscheinen in Home Assistant, abgehakte oder entfernte Einträge in Home Assistant werden hier übernommen. Über die Cookidoo-Integration von Home Assistant lässt sich so auch die Cookidoo-Einkaufsliste anbinden.')}</p>
      {loading ? <Loading /> : error ? <Alert type="error">{error.message}</Alert> : !data.items.length ? (
        <Alert type="warn">{t('Keine To-do-Listen gefunden. Ein Administrator muss zuerst Home Assistant unter Administration verbinden.')}</Alert>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          {data.items.map((e) => (
            <button key={e.entity_id} className="card row" style={{ padding: '10px 14px', textAlign: 'left', cursor: 'pointer' }} disabled={busy || linked.has(e.entity_id)} onClick={() => link(e.entity_id)}>
              <HomeIcon size={18} />
              <span style={{ flex: 1 }}><b>{e.name}</b><br /><span className="tiny faint">{e.entity_id}{e.entity_id.includes('cookidoo') ? ' · Cookidoo' : ''}</span></span>
              {linked.has(e.entity_id) ? <span className="badge green">{t('Verknüpft')}</span> : <Link2 size={16} />}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function ShoppingList() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const { id } = useParams();
  const { data: list, error, loading, reload, setData } = useApi(`/api/shopping/${id}`);
  const [text, setText] = useState('');
  const [edit, setEdit] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [group, setGroup] = useState(() => localStorage.getItem('shop-group') !== '0');
  const canEdit = list?.perm === 'edit';

  const refresh = useCallback(() => reload(), [reload]);
  useEffect(() => onServerEvent((ev) => {
    if (ev.type === 'shopping' && String(ev.listId) === String(id)) {
      if (ev.deleted) navigate('/shopping'); else refresh();
    }
  }), [id, refresh, navigate]);
  useEffect(() => {
    const fn = () => refresh();
    window.addEventListener('rb:queue-flushed', fn);
    window.addEventListener('focus', fn);
    return () => { window.removeEventListener('rb:queue-flushed', fn); window.removeEventListener('focus', fn); };
  }, [refresh]);

  const grouped = useMemo(() => {
    if (!list) return [];
    const open = list.items.filter((i) => !i.checked);
    if (!group) return [{ key: 'all', items: open }];
    const m = new Map();
    for (const i of open) {
      const c = CATS[i.category] ? i.category : 'other';
      if (!m.has(c)) m.set(c, []);
      m.get(c).push(i);
    }
    return CAT_ORDER.filter((c) => m.has(c)).map((c) => ({ key: c, label: CATS[c], items: m.get(c) }));
  }, [list, group]);
  const checked = list?.items.filter((i) => i.checked) || [];

  if (loading && !list) return <Loading />;
  if (error) return <div className="page"><ErrorBox error={error} onRetry={reload} /></div>;

  const add = async (e) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    setText('');
    const p = parseLine(v) || { name: v };
    const temp = { id: `tmp${Date.now()}`, name: p.name, amount: p.amount === '' ? null : p.amount, unit: p.unit, note: p.note, checked: false, category: 'other', sources: [] };
    setData((l) => ({ ...l, items: [...l.items, temp] }));
    try {
      const r = await api.post(`/api/shopping/${id}/items`, { text: v });
      if (!r.__queued) reload();
    } catch (err) { toast(err.message, { type: 'error' }); reload(); }
  };
  const toggle = async (item) => {
    setData((l) => ({ ...l, items: l.items.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i)) }));
    if (String(item.id).startsWith('tmp')) return;
    try { await api.put(`/api/shopping/${id}/items/${item.id}`, { checked: !item.checked }); } catch (err) { toast(err.message, { type: 'error' }); reload(); }
  };
  const saveItem = async (f) => {
    await api.put(`/api/shopping/${id}/items/${edit.id}`, f);
    setEdit(null);
    reload();
  };
  const deleteItem = async (item) => {
    setData((l) => ({ ...l, items: l.items.filter((i) => i.id !== item.id) }));
    setEdit(null);
    await api.del(`/api/shopping/${id}/items/${item.id}`).catch(() => reload());
  };
  const sync = async () => {
    try { await api.post(`/api/shopping/${id}/sync`); reload(); toast(t('Abgeglichen')); } catch (e) { toast(e.message, { type: 'error' }); }
  };

  const itemRow = (i) => (
    <div key={i.id} className={`shop-item ${i.checked ? 'checked' : ''}`}>
      <button className="cb" onClick={() => canEdit && toggle(i)} aria-label={t('Abhaken')}>{i.checked && <Check size={16} strokeWidth={3} />}</button>
      <div className="shop-name" onClick={() => canEdit && !String(i.id).startsWith('tmp') && setEdit(i)}>
        {(i.amount != null || i.unit) && <span className="shop-qty">{formatAmount(i.amount, i.unit)} {i.unit}</span>}
        <b>{i.name}</b>
        {i.note && <span className="faint small"> · {i.note}</span>}
        {i.sources?.some((s) => s.type === 'recipe') && <div className="shop-src">{[...new Set(i.sources.filter((s) => s.type === 'recipe').map((s) => s.title))].join(', ')}</div>}
      </div>
    </div>
  );

  return (
    <div className="page narrow">
      <div className="row" style={{ marginBottom: 6 }}>
        <Link to="/shopping" className="btn ghost small" onClick={() => sessionStorage.setItem('shop-auto', '1')}><ChevronLeft size={18} />{t('Alle Listen')}</Link>
      </div>
      <div className="page-head">
        <div>
          <h1>{list.name}</h1>
          <p className="sub">
            {t('{n} offen', { n: list.items.filter((i) => !i.checked).length })}
            {list.group && <> · <Users size={13} style={{ verticalAlign: -2 }} /> {list.group.name}</>}
            {list.__offline && <> · <span className="badge yellow">{t('Offline')}</span></>}
          </p>
        </div>
        <div className="btn-row">
          {list.links.length > 0 && <button className="btn icon" onClick={sync} title={t('Jetzt abgleichen')}><RefreshCw size={18} /></button>}
          <Menu trigger={({ toggle: tg }) => <button className="btn icon" onClick={tg}><MoreHorizontal size={20} /></button>}>
            <button onClick={() => { setGroup(!group); localStorage.setItem('shop-group', group ? '0' : '1'); }}>{group ? t('Nicht nach Abteilung sortieren') : t('Nach Abteilung sortieren')}</button>
            {canEdit && <button onClick={() => setDialog('rename')}><Pencil size={16} />{t('Umbenennen / Teilen')}</button>}
            {canEdit && <button onClick={() => setDialog('ha')}><HomeIcon size={16} />{t('Home Assistant / Cookidoo verknüpfen')}</button>}
            {canEdit && checked.length > 0 && <button onClick={async () => { await api.post(`/api/shopping/${id}/to-pantry`); toast(t('Gekaufte Einträge in den Vorratsschrank verschoben')); reload(); }}><Archive size={16} />{t('Gekauftes in den Vorrat')}</button>}
            {canEdit && checked.length > 0 && <button onClick={async () => { await api.post(`/api/shopping/${id}/clear-checked`); reload(); }}><Check size={16} />{t('Erledigte entfernen')}</button>}
            {canEdit && <><hr /><button className="danger" onClick={() => setDialog('delete')}><Trash2 size={16} />{t('Liste löschen')}</button></>}
          </Menu>
        </div>
      </div>

      {list.links.length > 0 && (
        <div className="chips" style={{ marginBottom: 12 }}>
          {list.links.map((l) => (
            <span key={l.id} className={`chip ${l.last_error ? '' : 'active'}`} title={l.last_error || (l.last_sync ? `${t('Zuletzt abgeglichen')}: ${formatDateTime(l.last_sync, t.lang)}` : '')}>
              {l.last_error ? <AlertTriangle size={13} color="var(--red)" /> : <HomeIcon size={13} />}{l.entity_id}
              {canEdit && <X size={13} onClick={async () => { await api.del(`/api/shopping/${id}/links/${l.id}`); reload(); }} />}
            </span>
          ))}
        </div>
      )}

      {canEdit && (
        <form className="shop-add" onSubmit={add}>
          <input className="input" style={{ minHeight: 48, fontSize: '1.02rem' }} placeholder={t('z. B. 2 kg Kartoffeln')} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn primary" style={{ minHeight: 48 }} aria-label={t('Hinzufügen')}><Plus size={22} /></button>
        </form>
      )}

      {!list.items.length && <Empty icon={ShoppingCart} title={t('Die Liste ist leer')} text={t('Füge oben Einträge hinzu oder übernimm Zutaten aus einem Rezept bzw. dem Wochenplan.')} />}
      {grouped.map((g) => g.items.length > 0 && (
        <div className="shop-cat" key={g.key}>
          {g.label && <h4>{t(g.label)}</h4>}
          <div className="shop-items">{g.items.map(itemRow)}</div>
        </div>
      ))}
      {checked.length > 0 && (
        <div className="shop-cat mt-lg">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h4>{t('Erledigt')} ({checked.length})</h4>
            {canEdit && <button className="btn ghost small" onClick={async () => { await api.post(`/api/shopping/${id}/clear-checked`); reload(); }}>{t('Entfernen')}</button>}
          </div>
          <div className="shop-items">{checked.map(itemRow)}</div>
        </div>
      )}

      {edit && <ItemEditor item={edit} onClose={() => setEdit(null)} onSave={saveItem} onDelete={() => deleteItem(edit)} />}
      {dialog === 'ha' && <HaDialog list={list} onClose={(c) => { setDialog(null); if (c) reload(); }} />}
      {dialog === 'delete' && <Confirm title={t('Liste löschen?')} text={t('Die Liste und alle Einträge werden gelöscht.')} danger confirmLabel={t('Löschen')} onConfirm={async () => { await api.del(`/api/shopping/${id}`); navigate('/shopping'); }} onClose={() => setDialog(null)} />}
      {dialog === 'rename' && <RenameList list={list} onClose={(c) => { setDialog(null); if (c) reload(); }} />}
    </div>
  );
}

function RenameList({ list, onClose }) {
  const t = useT();
  const [name, setName] = useState(list.name);
  const [groupId, setGroupId] = useState(list.group_id);
  const { groups } = useApp();
  return (
    <Modal title={t('Liste bearbeiten')} onClose={() => onClose()} footer={<><button className="btn" onClick={() => onClose()}>{t('Abbrechen')}</button><button className="btn primary" onClick={async () => { await api.put(`/api/shopping/${list.id}`, { name, group_id: groupId }); onClose(true); }}>{t('Speichern')}</button></>}>
      <div className="field"><label>{t('Name')}</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      {groups.length > 0 && <ScopeSelect value={groupId} onChange={setGroupId} label={t('Teilen mit')} />}
    </Modal>
  );
}
