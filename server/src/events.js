// Einfache Server-Sent-Events-Verteilung für Echtzeit-Aktualisierungen.
import { knex } from './db.js';

const clients = new Map(); // userId -> Set<res>

export function subscribe(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
  return () => {
    const set = clients.get(userId);
    if (!set) return;
    set.delete(res);
    if (!set.size) clients.delete(userId);
  };
}

function send(userIds, event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const id of new Set(userIds)) {
    for (const res of clients.get(id) || []) res.write(payload);
  }
}

// Benachrichtigt Eigentümer bzw. alle Mitglieder einer Gruppe.
export async function notifyScope({ ownerId, groupId }, event) {
  const ids = [ownerId];
  if (groupId) {
    const rows = await knex('group_members').where({ group_id: groupId }).select('user_id');
    ids.push(...rows.map((r) => r.user_id));
  }
  send(ids.filter(Boolean), event);
}

export function notifyUsers(ids, event) {
  send(ids, event);
}

setInterval(() => {
  for (const set of clients.values()) for (const res of set) res.write(': ping\n\n');
}, 25000).unref();
