// API-Client mit Offline-Unterstützung:
// - GET-Antworten ausgewählter Pfade werden in IndexedDB gespeichert und offline daraus gelesen.
// - Änderungen an Einkaufslisten werden offline in einer Warteschlange gesammelt und später gesendet.
import { get, set, del, keys } from 'idb-keyval';

const CACHE_PATTERNS = [
  /^\/api\/recipes\/\d+$/,
  /^\/api\/plan\?/,
  /^\/api\/shopping(\/\d+)?(\?.*)?$/,
  /^\/api\/home/,
  /^\/api\/auth\/me$/,
  /^\/api\/groups$/,
  /^\/api\/cookbooks$/,
  /^\/api\/pantry(\?.*)?$/,
  /^\/api\/offline-recipes$/,
  /^\/api\/recipes\?/,
];
const QUEUE_PATTERNS = [/^\/api\/shopping\/\d+\/items/];

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const listeners = new Set();
export const onNetworkChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
let offline = typeof navigator !== 'undefined' ? !navigator.onLine : false;
export const isOffline = () => offline;
function setOffline(v) {
  if (offline !== v) {
    offline = v;
    listeners.forEach((fn) => fn(v));
    if (!v) flushQueue();
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => setOffline(false));
  window.addEventListener('offline', () => setOffline(true));
}

async function request(method, url, body, opts = {}) {
  const isForm = body instanceof FormData;
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    setOffline(true);
    throw new ApiError('Keine Verbindung zum Server', 0, 'offline');
  }
  if (offline) setOffline(false);
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError(data?.error || `Fehler ${res.status}`, res.status, data?.code);
  return data;
}

const cacheKey = (url) => `api:${url}`;

export async function apiGet(url, opts = {}) {
  const cacheable = CACHE_PATTERNS.some((p) => p.test(url));
  try {
    const data = await request('GET', url, null, opts);
    if (cacheable) set(cacheKey(url), { data, at: Date.now() }).catch(() => {});
    return data;
  } catch (err) {
    if (err.code === 'offline' && cacheable) {
      const hit = await get(cacheKey(url)).catch(() => null);
      if (hit) return { ...hit.data, __offline: true, __cachedAt: hit.at };
    }
    throw err;
  }
}

export async function apiSend(method, url, body) {
  try {
    return await request(method, url, body);
  } catch (err) {
    if (err.code === 'offline' && QUEUE_PATTERNS.some((p) => p.test(url)) && !(body instanceof FormData)) {
      const q = (await get('queue')) || [];
      q.push({ method, url, body, at: Date.now() });
      await set('queue', q);
      return { __queued: true };
    }
    throw err;
  }
}

export const api = {
  get: apiGet,
  post: (url, body) => apiSend('POST', url, body || {}),
  put: (url, body) => apiSend('PUT', url, body || {}),
  del: (url) => apiSend('DELETE', url),
  upload: (url, formData) => request('POST', url, formData),
};

let flushing = false;
export async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    const q = (await get('queue')) || [];
    let i = 0;
    for (; i < q.length; i++) {
      try {
        await request(q[i].method, q[i].url, q[i].body);
      } catch (err) {
        if (err.code === 'offline') break;
        // Andere Fehler (z. B. Eintrag inzwischen gelöscht) werden verworfen
      }
    }
    if (i < q.length) await set('queue', q.slice(i));
    else await del('queue');
    if (q.length && i === q.length) window.dispatchEvent(new CustomEvent('rb:queue-flushed'));
  } finally {
    flushing = false;
  }
}

export async function queuedCount() {
  return ((await get('queue')) || []).length;
}

/** Ein Rezept samt Bildern für die Offline-Nutzung vorhalten. */
export async function cacheRecipeOffline(id) {
  const data = await apiGet(`/api/recipes/${id}`);
  if ('caches' in window) {
    const cache = await caches.open('images');
    for (const u of [data.image_url, data.thumb_url, ...(data.image_urls || [])].filter(Boolean)) {
      cache.add(u).catch(() => {});
    }
  }
  return data;
}

export async function clearApiCache() {
  for (const k of await keys()) if (String(k).startsWith('api:')) await del(k);
}

// Echtzeit-Ereignisse (Server-Sent Events)
let source = null;
const eventListeners = new Set();
export function onServerEvent(fn) {
  eventListeners.add(fn);
  ensureEvents();
  return () => eventListeners.delete(fn);
}
export function ensureEvents() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/events');
  source.onmessage = (e) => {
    try {
      const ev = JSON.parse(e.data);
      eventListeners.forEach((fn) => fn(ev));
    } catch { /* ignore */ }
  };
  source.onerror = () => {
    if (source?.readyState === EventSource.CLOSED) {
      source = null;
      setTimeout(ensureEvents, 5000);
    }
  };
}
export function closeEvents() {
  source?.close();
  source = null;
}
