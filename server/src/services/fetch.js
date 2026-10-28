// Abrufe externer URLs mit Größen- und Zeitbegrenzung sowie Schutz vor internen Zielen (SSRF).
import dns from 'node:dns/promises';
import net from 'node:net';

function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v === '::' || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
}

export async function assertPublicUrl(url) {
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Nur http(s)-Links werden unterstützt');
  if (process.env.ALLOW_PRIVATE_FETCH === 'true') return u;
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (addrs.some((a) => isPrivate(a.address))) throw new Error('Interne Adressen sind nicht erlaubt');
  return u;
}

export async function safeFetch(url, { timeout = 15000, maxBytes = 5 * 1024 * 1024, headers = {}, allowPrivate = false, method = 'GET', body } = {}) {
  if (!allowPrivate) await assertPublicUrl(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      body,
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'de,en;q=0.8',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('Antwort zu groß');
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    return { status: res.status, headers: res.headers, buffer, text: () => buffer.toString('utf8'), json: () => JSON.parse(buffer.toString('utf8')), url: res.url };
  } finally {
    clearTimeout(timer);
  }
}
