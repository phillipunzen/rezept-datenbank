import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { Search, Trash2, Copy, Link2, Globe, Users, Plus, Check } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app.jsx';
import { useT } from '../lib/i18n.js';
import { Modal, useToast, useApi, Loading, Alert, Stars, useDebounced, Img } from './ui.jsx';
import { isoDate, formatDate, formatAmount } from '../lib/format.js';

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
export const MEAL_LABEL = { breakfast: 'Frühstück', lunch: 'Mittagessen', dinner: 'Abendessen', snack: 'Snack' };

/** Bereichsauswahl: Persönlich oder eine Gruppe */
export function ScopeSelect({ value, onChange, allowViewer = false, label }) {
  const t = useT();
  const { groups } = useApp();
  return (
    <div className="field">
      <label>{label || t('Bereich')}</label>
      <select className="input" value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t('Persönlich')}</option>
        {groups.filter((g) => allowViewer || g.role !== 'viewer').map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
    </div>
  );
}

export function AddToPlanDialog({ recipe, onClose, defaultDate, defaultMeal = 'dinner', defaultScope }) {
  const t = useT();
  const toast = useToast();
  const [date, setDate] = useState(defaultDate || isoDate(new Date()));
  const [meal, setMeal] = useState(defaultMeal);
  const [servings, setServings] = useState(recipe.servings || 4);
  const [scope, setScope] = useState(defaultScope || recipe.group_id || null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post('/api/plan', { recipe_id: recipe.id, date, meal, servings, group_id: scope });
      toast(t('Zum Wochenplan hinzugefügt'));
      onClose(true);
    } catch (e) { toast(e.message, { type: 'error' }); } finally { setBusy(false); }
  };
  return (
    <Modal title={t('In den Wochenplan')} onClose={() => onClose()} footer={<>
      <button className="btn" onClick={() => onClose()}>{t('Abbrechen')}</button>
      <button className="btn primary" disabled={busy} onClick={save}>{t('Einplanen')}</button>
    </>}>
      <p className="muted" style={{ marginBottom: 14 }}><b>{recipe.title}</b></p>
      <div className="grid-2">
        <div className="field"><label>{t('Datum')}</label><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label>{t('Portionen')}</label><input type="number" min="1" step="1" className="input" value={servings} onChange={(e) => setServings(e.target.value)} /></div>
      </div>
      <div className="field">
        <label>{t('Mahlzeit')}</label>
        <div className="chips">{MEALS.map((m) => <button key={m} className={`chip ${meal === m ? 'active' : ''}`} onClick={() => setMeal(m)}>{t(MEAL_LABEL[m])}</button>)}</div>
      </div>
      <ScopeSelect value={scope} onChange={setScope} label={t('Wochenplan')} />
    </Modal>
  );
}

export function ListSelect({ value, onChange }) {
  const t = useT();
  const { data } = useApi('/api/shopping');
  useEffect(() => {
    if (data?.items?.length && value === undefined) onChange(String(data.items[0].id));
    if (data && !data.items.length && value === undefined) onChange('new');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  return (
    <div className="field">
      <label>{t('Einkaufsliste')}</label>
      <select className="input" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        {data?.items.map((l) => <option key={l.id} value={l.id}>{l.name}{l.group_name ? ` · ${l.group_name}` : ''}</option>)}
        <option value="new">+ {t('Neue Liste')}</option>
      </select>
    </div>
  );
}

export function AddToShoppingDialog({ recipe, servings, ingredients, onClose }) {
  const t = useT();
  const toast = useToast();
  const [listId, setListId] = useState(undefined);
  const [newName, setNewName] = useState(t('Einkaufsliste'));
  const [srv, setSrv] = useState(servings || recipe.servings);
  const all = (ingredients || recipe.ingredients).flatMap((g) => g.items);
  const [selected, setSelected] = useState(() => new Set(all.map((i) => i.name)));
  const [busy, setBusy] = useState(false);
  const factor = (Number(srv) || recipe.servings) / (recipe.servings || 1);
  const save = async () => {
    setBusy(true);
    try {
      let id = listId;
      if (id === 'new') id = (await api.post('/api/shopping', { name: newName, group_id: recipe.group_id })).id;
      const r = await api.post(`/api/shopping/${id}/recipe`, { recipe_id: recipe.id, servings: srv, only: [...selected], use_variant: !!ingredients });
      toast(r.__queued ? t('Wird übertragen, sobald du online bist') : t('{n} Zutaten zur Einkaufsliste hinzugefügt', { n: r.added }), {
        action: { label: t('Öffnen'), fn: () => { window.location.href = `/shopping/${id}`; } },
      });
      onClose(true);
    } catch (e) { toast(e.message, { type: 'error' }); } finally { setBusy(false); }
  };
  return (
    <Modal title={t('Auf die Einkaufsliste')} onClose={() => onClose()} footer={<>
      <button className="btn" onClick={() => onClose()}>{t('Abbrechen')}</button>
      <button className="btn primary" disabled={busy || !selected.size} onClick={save}>{t('{n} Zutaten hinzufügen', { n: selected.size })}</button>
    </>}>
      <div className="grid-2">
        <ListSelect value={listId} onChange={setListId} />
        <div className="field"><label>{t('Portionen')}</label><input type="number" min="1" className="input" value={srv} onChange={(e) => setSrv(e.target.value)} /></div>
      </div>
      {listId === 'new' && <div className="field"><label>{t('Name der neuen Liste')}</label><input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} /></div>}
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="label">{t('Zutaten')}</span>
        <span className="link small" onClick={() => setSelected(selected.size === all.length ? new Set() : new Set(all.map((i) => i.name)))}>
          {selected.size === all.length ? t('Keine') : t('Alle')}
        </span>
      </div>
      <div className="select-list" style={{ maxHeight: 320 }}>
        {all.map((i, idx) => (
          <label key={idx}>
            <input type="checkbox" checked={selected.has(i.name)} onChange={(e) => {
              const n = new Set(selected);
              if (e.target.checked) n.add(i.name); else n.delete(i.name);
              setSelected(n);
            }} />
            <span style={{ minWidth: 70, fontWeight: 700, textAlign: 'right' }}>{formatAmount(i.amount != null ? i.amount * factor : null, i.unit)} {i.unit}</span>
            <span>{i.name}</span>
          </label>
        ))}
      </div>
      <p className="hint mt">{t('Gleiche Zutaten werden mit vorhandenen Einträgen zusammengefasst.')}</p>
    </Modal>
  );
}

export function CookbookDialog({ recipe, onClose }) {
  const t = useT();
  const toast = useToast();
  const { data, reload } = useApi('/api/cookbooks');
  const [inBooks, setInBooks] = useState(new Set((recipe.cookbooks || []).map((c) => c.id)));
  const [newName, setNewName] = useState('');
  const toggle = async (cb) => {
    const has = inBooks.has(cb.id);
    try {
      if (has) await api.del(`/api/cookbooks/${cb.id}/recipes/${recipe.id}`);
      else await api.post(`/api/cookbooks/${cb.id}/recipes`, { recipe_id: recipe.id });
      const n = new Set(inBooks);
      if (has) n.delete(cb.id); else n.add(cb.id);
      setInBooks(n);
    } catch (e) { toast(e.message, { type: 'error' }); }
  };
  const create = async () => {
    if (!newName.trim()) return;
    const { id } = await api.post('/api/cookbooks', { name: newName });
    await api.post(`/api/cookbooks/${id}/recipes`, { recipe_id: recipe.id });
    setInBooks(new Set([...inBooks, id]));
    setNewName('');
    reload();
  };
  const privateInShared = !recipe.group_id && data?.items.some((c) => c.group_id && inBooks.has(c.id));
  return (
    <Modal title={t('Rezeptbücher')} onClose={() => onClose(true)} footer={<button className="btn primary" onClick={() => onClose(true)}>{t('Fertig')}</button>}>
      {!data ? <Loading /> : (
        <div className="stack">
          {data.items.map((cb) => (
            <label key={cb.id} className="check card" style={{ padding: '10px 14px' }}>
              <input type="checkbox" checked={inBooks.has(cb.id)} onChange={() => toggle(cb)} disabled={cb.group_id && data.items && false} />
              <span style={{ flex: 1 }}>{cb.name}</span>
              {cb.group_name && <span className="badge"><Users size={11} />{cb.group_name}</span>}
            </label>
          ))}
          {!data.items.length && <p className="muted">{t('Noch keine Rezeptbücher vorhanden.')}</p>}
          {privateInShared && <Alert type="info">{t('Mitglieder der Gruppe können dieses Rezept über das gemeinsame Rezeptbuch ansehen.')}</Alert>}
          <div className="row">
            <input className="input" placeholder={t('Neues Rezeptbuch …')} value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
            <button className="btn" onClick={create} disabled={!newName.trim()}><Plus size={18} /></button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function CookedDialog({ recipe, servings, onClose }) {
  const t = useT();
  const toast = useToast();
  const [form, setForm] = useState({ cooked_at: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16), notes: '', rating: recipe.my_rating || 0, servings: servings || recipe.servings });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/api/recipes/${recipe.id}/cooked`, { ...form, cooked_at: new Date(form.cooked_at).toISOString() });
      toast(t('Gespeichert – guten Appetit!'));
      onClose(true);
    } catch (e) { toast(e.message, { type: 'error' }); } finally { setBusy(false); }
  };
  return (
    <Modal title={t('Gekocht!')} onClose={() => onClose()} footer={<>
      <button className="btn" onClick={() => onClose()}>{t('Überspringen')}</button>
      <button className="btn primary" disabled={busy} onClick={save}>{t('Speichern')}</button>
    </>}>
      <div className="grid-2">
        <div className="field"><label>{t('Wann?')}</label><input type="datetime-local" className="input" value={form.cooked_at} onChange={(e) => setForm({ ...form, cooked_at: e.target.value })} /></div>
        <div className="field"><label>{t('Portionen')}</label><input type="number" className="input" value={form.servings} onChange={(e) => setForm({ ...form, servings: e.target.value })} /></div>
      </div>
      <div className="field"><label>{t('Wie war es?')}</label><Stars value={form.rating} onChange={(r) => setForm({ ...form, rating: r })} size={28} /></div>
      <div className="field"><label>{t('Notizen')}</label><textarea className="input" placeholder={t('z. B. weniger Salz, 5 Minuten länger backen …')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
    </Modal>
  );
}

export function RecipePicker({ onPick, onClose, title }) {
  const t = useT();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [fav, setFav] = useState(false);
  const { data, loading } = useApi(`/api/recipes?limit=40&q=${encodeURIComponent(dq)}${fav ? '&favorites=1' : ''}`);
  const [free, setFree] = useState('');
  return (
    <Modal title={title || t('Rezept auswählen')} onClose={onClose} wide>
      <div className="row" style={{ marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={18} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-faint)' }} />
          <input autoFocus className="input" style={{ paddingLeft: 38 }} placeholder={t('Rezept suchen …')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className={`chip ${fav ? 'active' : ''}`} onClick={() => setFav(!fav)}>{t('Favoriten')}</button>
      </div>
      {loading && !data ? <Loading /> : (
        <div className="select-list" style={{ maxHeight: 380 }}>
          {data?.items.map((r) => (
            <label key={r.id} onClick={() => onPick(r)}>
              {r.thumb_url ? <img src={r.thumb_url} alt="" /> : <div className="noimg" />}
              <span style={{ flex: 1 }}><b>{r.title}</b><br /><span className="tiny muted">{r.category}</span></span>
            </label>
          ))}
          {data && !data.items.length && <div className="pad muted center" style={{ padding: 20 }}>{t('Keine Rezepte gefunden')}</div>}
        </div>
      )}
      <div className="divider" />
      <div className="label" style={{ marginBottom: 6 }}>{t('Oder ohne Rezept eintragen')}</div>
      <div className="row">
        <input className="input" placeholder={t('z. B. Essen gehen, Reste …')} value={free} onChange={(e) => setFree(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && free.trim() && onPick({ title: free.trim() })} />
        <button className="btn" disabled={!free.trim()} onClick={() => onPick({ title: free.trim() })}>{t('Eintragen')}</button>
      </div>
    </Modal>
  );
}

export function ShareDialog({ recipe, onClose }) {
  const t = useT();
  const toast = useToast();
  const { groups } = useApp();
  const { data, reload } = useApi(`/api/recipes/${recipe.id}/sharing`);
  const [who, setWho] = useState('');
  const [perm, setPerm] = useState('view');
  const [qr, setQr] = useState({});
  const isOwner = data?.perm === 'owner';

  useEffect(() => {
    if (!data) return;
    const urls = [...(data.links || []).map((l) => `${location.origin}/s/${l.token}`), data.is_public ? `${location.origin}/p/${data.public_slug}` : null].filter(Boolean);
    Promise.all(urls.map((u) => QRCode.toDataURL(u, { margin: 1, width: 180 }).then((d) => [u, d]))).then((e) => setQr(Object.fromEntries(e)));
  }, [data]);

  const copy = async (u) => {
    try { await navigator.clipboard.writeText(u); toast(t('Link kopiert')); } catch { prompt(t('Link'), u); }
  };
  const act = async (fn) => { try { await fn(); reload(); } catch (e) { toast(e.message, { type: 'error' }); } };

  return (
    <Modal title={t('Teilen & Veröffentlichen')} onClose={() => onClose(true)} wide footer={<button className="btn primary" onClick={() => onClose(true)}>{t('Fertig')}</button>}>
      {!data ? <Loading /> : (
        <div className="stack lg">
          {isOwner && (
            <section>
              <h3 style={{ marginBottom: 8 }}><Users size={17} style={{ verticalAlign: -3 }} /> {t('Gemeinsames Rezeptbuch')}</h3>
              <select className="input" value={data.group_id || ''} onChange={(e) => act(() => api.put(`/api/recipes/${recipe.id}/sharing`, { group_id: e.target.value || null }))}>
                <option value="">{t('Privat (nur ich und gezielte Freigaben)')}</option>
                {groups.filter((g) => g.role !== 'viewer').map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <p className="hint" style={{ marginTop: 6 }}>{t('Mitglieder mit Bearbeitungsrecht können das Rezept ändern, Betrachter nur ansehen.')}</p>
            </section>
          )}
          {isOwner && (
            <section>
              <h3 style={{ marginBottom: 8 }}>{t('Mit einzelnen Personen oder Gruppen teilen')}</h3>
              <div className="row wrap">
                <input className="input" style={{ flex: 2, minWidth: 180 }} placeholder={t('E-Mail oder Benutzername')} value={who} onChange={(e) => setWho(e.target.value)} />
                <select className="input" style={{ flex: 1, minWidth: 120 }} value={perm} onChange={(e) => setPerm(e.target.value)}>
                  <option value="view">{t('Ansehen')}</option>
                  <option value="edit">{t('Bearbeiten')}</option>
                </select>
                <button className="btn" disabled={!who.trim()} onClick={() => act(async () => { await api.post(`/api/recipes/${recipe.id}/shares`, { user: who, permission: perm }); setWho(''); })}>{t('Teilen')}</button>
              </div>
              {groups.length > 0 && (
                <div className="chips mt">
                  {groups.filter((g) => !data.shares.some((s) => s.group_id === g.id)).map((g) => (
                    <button key={g.id} className="chip" onClick={() => act(() => api.post(`/api/recipes/${recipe.id}/shares`, { group_id: g.id, permission: perm }))}><Plus size={13} />{g.name}</button>
                  ))}
                </div>
              )}
              {data.shares.length > 0 && (
                <div className="stack mt" style={{ gap: 6 }}>
                  {data.shares.map((s) => (
                    <div key={s.id} className="row card" style={{ padding: '8px 12px' }}>
                      {s.group_id ? <Users size={16} /> : null}
                      <span style={{ flex: 1 }}>{s.name}{s.email ? <span className="faint small"> · {s.email}</span> : null}</span>
                      <span className="badge">{s.permission === 'edit' ? t('Bearbeiten') : t('Ansehen')}</span>
                      <button className="btn ghost icon small" onClick={() => act(() => api.del(`/api/recipes/${recipe.id}/shares/${s.id}`))}><Trash2 size={16} /></button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          <section>
            <h3 style={{ marginBottom: 8 }}><Link2 size={17} style={{ verticalAlign: -3 }} /> {t('Link & QR-Code')}</h3>
            <p className="hint" style={{ marginBottom: 10 }}>{t('Jeder mit dem Link kann das Rezept ohne Konto ansehen (ohne Quelle und private Notizen). Du kannst den Link jederzeit widerrufen.')}</p>
            {data.links.map((l) => {
              const u = `${location.origin}/s/${l.token}`;
              return (
                <div key={l.id} className="row wrap card" style={{ padding: 12, marginBottom: 8, alignItems: 'flex-start' }}>
                  {qr[u] && <img className="qr" src={qr[u]} alt="QR" width={120} height={120} />}
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <code className="small" style={{ wordBreak: 'break-all' }}>{u}</code>
                    <div className="btn-row mt">
                      <button className="btn small" onClick={() => copy(u)}><Copy size={15} />{t('Kopieren')}</button>
                      {navigator.share && <button className="btn small" onClick={() => navigator.share({ title: recipe.title, url: u }).catch(() => {})}>{t('Teilen …')}</button>}
                      <button className="btn small danger" onClick={() => act(() => api.del(`/api/recipes/${recipe.id}/links/${l.id}`))}>{t('Widerrufen')}</button>
                    </div>
                  </div>
                </div>
              );
            })}
            <button className="btn" onClick={() => act(() => api.post(`/api/recipes/${recipe.id}/links`))}><Plus size={17} />{t('Neuen Link erstellen')}</button>
          </section>
          {isOwner && (
            <section>
              <h3 style={{ marginBottom: 8 }}><Globe size={17} style={{ verticalAlign: -3 }} /> {t('Öffentlich')}</h3>
              <label className="switch">
                <input type="checkbox" checked={data.is_public} onChange={(e) => act(() => api.put(`/api/recipes/${recipe.id}/publish`, { public: e.target.checked }))} />
                {t('Im öffentlichen Bereich veröffentlichen')}
              </label>
              <p className="hint" style={{ marginTop: 6 }}>{t('Besucher ohne Konto können das Rezept entdecken und ansehen. Quellenangaben und Notizen bleiben privat.')}</p>
              {data.is_public && (
                <div className="row wrap card mt" style={{ padding: 12, alignItems: 'flex-start' }}>
                  {qr[`${location.origin}/p/${data.public_slug}`] && <img className="qr" src={qr[`${location.origin}/p/${data.public_slug}`]} alt="QR" width={120} height={120} />}
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <code className="small" style={{ wordBreak: 'break-all' }}>{`${location.origin}/p/${data.public_slug}`}</code>
                    <div className="btn-row mt">
                      <button className="btn small" onClick={() => copy(`${location.origin}/p/${data.public_slug}`)}><Copy size={15} />{t('Kopieren')}</button>
                      <a className="btn small" href={`/p/${data.public_slug}`} target="_blank" rel="noreferrer">{t('Ansehen')}</a>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

export function CookLog({ log, recipeId, onChange }) {
  const t = useT();
  if (!log?.length) return <p className="muted small">{t('Noch nicht gekocht.')}</p>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {log.map((l) => (
        <div key={l.id} className="card" style={{ padding: '10px 14px' }}>
          <div className="row">
            <Check size={16} style={{ color: 'var(--green)' }} />
            <b className="small">{formatDate(l.cooked_at, t.lang)}</b>
            <span className="faint small">{l.user}{l.servings ? ` · ${t('{n} Portionen', { n: l.servings })}` : ''}</span>
            <span className="spacer" />
            {l.rating ? <Stars value={l.rating} size={13} /> : null}
            {l.mine && <button className="btn ghost icon small" onClick={async () => { await api.del(`/api/recipes/${recipeId}/cooked/${l.id}`); onChange?.(); }}><Trash2 size={14} /></button>}
          </div>
          {l.notes && <p className="small" style={{ marginTop: 6, whiteSpace: 'pre-line' }}>{l.notes}</p>}
        </div>
      ))}
    </div>
  );
}

export { Img };
