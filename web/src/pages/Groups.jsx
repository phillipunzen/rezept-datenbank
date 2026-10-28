import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Users, Plus, ChevronLeft, Trash2, Copy, LogOut, UserPlus, Link2 } from 'lucide-react';
import QRCode from 'qrcode';
import { api } from '../lib/api.js';
import { useApp } from '../lib/app.jsx';
import { useT } from '../lib/i18n.js';
import { useApi, Loading, Empty, ErrorBox, Modal, Confirm, useToast, Avatar, Alert } from '../components/ui.jsx';
import { formatDate } from '../lib/format.js';

const ROLE = { owner: 'Verwalter', editor: 'Bearbeiten', viewer: 'Nur ansehen' };

export default function Groups() {
  const t = useT();
  const navigate = useNavigate();
  const { loadGroups } = useApp();
  const { data, error, loading, reload } = useApi('/api/groups');
  const [form, setForm] = useState(null);
  const create = async () => {
    const d = await api.post('/api/groups', form);
    await loadGroups();
    navigate(`/groups/${d.id}`);
  };
  return (
    <div className="page narrow">
      <div className="page-head">
        <div><h1>{t('Gruppen')}</h1><p className="sub">{t('Ein gemeinsames Rezeptbuch, gemeinsame Einkaufslisten und ein gemeinsamer Wochenplan – z. B. für deinen Haushalt.')}</p></div>
        <button className="btn primary" onClick={() => setForm({ name: '', description: '' })}><Plus size={18} />{t('Neue Gruppe')}</button>
      </div>
      {loading ? <Loading /> : <ErrorBox error={error} onRetry={reload} />}
      {data?.items.length === 0 && <Empty icon={Users} title={t('Noch keine Gruppe')} text={t('Erstelle eine Gruppe und lade Familie oder Mitbewohner ein.')} />}
      <div className="stack">
        {data?.items.map((g) => (
          <Link key={g.id} to={`/groups/${g.id}`} className="card list-tile">
            <span className="ico"><Users size={22} /></span>
            <div style={{ flex: 1 }}><b>{g.name}</b><div className="small muted">{t('{m} Mitglieder · {r} Rezepte', { m: g.member_count, r: g.recipe_count })}</div></div>
            <span className="badge">{t(ROLE[g.role])}</span>
          </Link>
        ))}
      </div>
      {form && (
        <Modal title={t('Neue Gruppe')} onClose={() => setForm(null)} footer={<><button className="btn" onClick={() => setForm(null)}>{t('Abbrechen')}</button><button className="btn primary" disabled={!form.name.trim()} onClick={create}>{t('Erstellen')}</button></>}>
          <div className="field"><label>{t('Name')}</label><input className="input" autoFocus placeholder={t('z. B. Familie Müller')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field"><label>{t('Beschreibung')}</label><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </Modal>
      )}
    </div>
  );
}

export function GroupDetail() {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const { user, loadGroups } = useApp();
  const { id } = useParams();
  const { data: g, error, loading, reload } = useApi(`/api/groups/${id}`);
  const [who, setWho] = useState('');
  const [role, setRole] = useState('editor');
  const [invite, setInvite] = useState(null);
  const [confirm, setConfirm] = useState(null);
  if (loading) return <Loading />;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  const owner = g.role === 'owner';
  const act = async (fn) => { try { await fn(); reload(); } catch (e) { toast(e.message, { type: 'error' }); } };
  const createInvite = async () => {
    const d = await api.post(`/api/groups/${id}/invites`, { role, days: 7 });
    const url = `${location.origin}/invite/${d.token}`;
    setInvite({ url, qr: await QRCode.toDataURL(url, { margin: 1, width: 200 }) });
    reload();
  };
  return (
    <div className="page narrow">
      <Link to="/groups" className="btn ghost small"><ChevronLeft size={18} />{t('Gruppen')}</Link>
      <div className="page-head mt">
        <div><h1>{g.name}</h1><p className="sub">{g.description}</p></div>
        <div className="btn-row">
          <Link to={`/recipes?scope=${g.id}`} className="btn">{t('Rezepte')}</Link>
          <button className="btn" onClick={() => setConfirm('leave')}><LogOut size={17} />{t('Verlassen')}</button>
          {owner && <button className="btn danger icon" onClick={() => setConfirm('delete')}><Trash2 size={17} /></button>}
        </div>
      </div>
      <div className="card pad">
        <h3 style={{ marginBottom: 12 }}>{t('Mitglieder')}</h3>
        <div className="stack" style={{ gap: 8 }}>
          {g.members.map((m) => (
            <div key={m.id} className="row">
              <Avatar user={m} />
              <div style={{ flex: 1 }}><b>{m.display_name}</b>{m.id === user.id && <span className="faint"> ({t('du')})</span>}<div className="tiny muted">{m.email}</div></div>
              {owner && m.id !== user.id ? (
                <>
                  <select className="input small" style={{ width: 'auto' }} value={m.role} onChange={(e) => act(() => api.put(`/api/groups/${id}/members/${m.id}`, { role: e.target.value }))}>
                    {Object.entries(ROLE).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
                  </select>
                  <button className="btn ghost icon small" onClick={() => act(() => api.del(`/api/groups/${id}/members/${m.id}`))}><Trash2 size={15} /></button>
                </>
              ) : <span className="badge">{t(ROLE[m.role])}</span>}
            </div>
          ))}
        </div>
      </div>
      {owner && (
        <div className="card pad mt">
          <h3 style={{ marginBottom: 6 }}><UserPlus size={18} style={{ verticalAlign: -3 }} /> {t('Mitglieder einladen')}</h3>
          <p className="small muted" style={{ marginBottom: 12 }}>{t('„Bearbeiten“ erlaubt das Ändern gemeinsamer Rezepte, Listen und Pläne. „Nur ansehen“ erlaubt nur Lesen.')}</p>
          <div className="row wrap">
            <input className="input" style={{ flex: 2, minWidth: 200 }} placeholder={t('E-Mail oder Benutzername eines bestehenden Kontos')} value={who} onChange={(e) => setWho(e.target.value)} />
            <select className="input" style={{ flex: 1, minWidth: 130 }} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="editor">{t('Bearbeiten')}</option><option value="viewer">{t('Nur ansehen')}</option><option value="owner">{t('Verwalter')}</option>
            </select>
            <button className="btn" disabled={!who.trim()} onClick={() => act(async () => { await api.post(`/api/groups/${id}/members`, { user: who, role }); setWho(''); toast(t('Hinzugefügt')); })}>{t('Hinzufügen')}</button>
          </div>
          <div className="divider" />
          <button className="btn" onClick={createInvite}><Link2 size={17} />{t('Einladungslink erstellen (7 Tage gültig)')}</button>
          {invite && (
            <div className="row wrap card mt" style={{ padding: 12, alignItems: 'flex-start' }}>
              <img className="qr" src={invite.qr} alt="QR" width={140} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <code className="small" style={{ wordBreak: 'break-all' }}>{invite.url}</code>
                <div className="btn-row mt"><button className="btn small" onClick={() => navigator.clipboard.writeText(invite.url).then(() => toast(t('Link kopiert')))}><Copy size={15} />{t('Kopieren')}</button></div>
              </div>
            </div>
          )}
          {g.invites.length > 0 && (
            <div className="mt">
              <div className="label" style={{ marginBottom: 6 }}>{t('Offene Einladungen')}</div>
              {g.invites.map((i) => (
                <div key={i.token} className="row small" style={{ marginBottom: 4 }}>
                  <code style={{ flex: 1 }}>…{i.token.slice(-8)}</code><span className="badge">{t(ROLE[i.role])}</span>
                  <span className="faint">{t('bis {d}', { d: formatDate(i.expires_at, t.lang) })}</span>
                  <button className="btn ghost icon small" onClick={() => act(() => api.del(`/api/groups/${id}/invites/${i.token}`))}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {confirm === 'leave' && <Confirm title={t('Gruppe verlassen?')} text={t('Du verlierst den Zugriff auf gemeinsame Inhalte dieser Gruppe.')} danger confirmLabel={t('Verlassen')}
        onConfirm={async () => { await api.del(`/api/groups/${id}/members/${user.id}`); await loadGroups(); navigate('/groups'); }} onClose={() => setConfirm(null)} />}
      {confirm === 'delete' && <Confirm title={t('Gruppe löschen?')} text={t('Gemeinsame Listen, Pläne und Rezeptbücher der Gruppe werden gelöscht. Rezepte bleiben bei ihren Erstellern (privat) erhalten.')} danger confirmLabel={t('Löschen')}
        onConfirm={async () => { await api.del(`/api/groups/${id}`); await loadGroups(); navigate('/groups'); }} onClose={() => setConfirm(null)} />}
    </div>
  );
}

export function Invite() {
  const t = useT();
  const navigate = useNavigate();
  const { loadGroups } = useApp();
  const { token } = useParams();
  const { data, error, loading } = useApi(`/api/invites/${token}`);
  if (loading) return <Loading />;
  return (
    <div className="page narrow">
      <div className="card pad center" style={{ maxWidth: 480, margin: '40px auto' }}>
        <Users size={44} style={{ color: 'var(--accent)' }} />
        {error ? <div className="mt"><Alert type="error">{error.message}</Alert></div> : (
          <>
            <h2 className="mt">{t('Einladung in „{g}“', { g: data.name })}</h2>
            <p className="muted mt">{t('Rolle')}: {t(ROLE[data.role])}</p>
            {data.member ? <Link to={`/groups/${data.group_id}`} className="btn primary mt">{t('Du bist bereits Mitglied')}</Link> : (
              <button className="btn primary large mt" onClick={async () => { await api.post(`/api/invites/${token}/accept`); await loadGroups(); navigate(`/groups/${data.group_id}`); }}>{t('Einladung annehmen')}</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
