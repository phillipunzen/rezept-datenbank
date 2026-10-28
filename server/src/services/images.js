import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { nanoid } from 'nanoid';
import { uploadsDir } from '../config.js';
import { safeFetch } from './fetch.js';

export async function ensureDirs() {
  await fs.mkdir(path.join(uploadsDir, 'recipes'), { recursive: true });
  await fs.mkdir(path.join(uploadsDir, 'avatars'), { recursive: true });
  await fs.mkdir(path.join(uploadsDir, 'tmp'), { recursive: true });
}

/** Speichert ein Bild als WebP (groß + Vorschaubild). Liefert den relativen Dateinamen. */
export async function saveImage(buffer, folder = 'recipes', maxSize = 1800) {
  const id = nanoid(16);
  const rel = `${folder}/${id}.webp`;
  const img = sharp(buffer, { failOn: 'none' }).rotate();
  await img.clone().resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 }).toFile(path.join(uploadsDir, rel));
  if (folder === 'recipes') {
    await img.clone().resize({ width: 640, height: 640, fit: 'cover' }).webp({ quality: 76 })
      .toFile(path.join(uploadsDir, `${folder}/${id}.thumb.webp`));
  }
  return rel;
}

export async function saveAvatar(buffer) {
  const id = nanoid(16);
  const rel = `avatars/${id}.webp`;
  await sharp(buffer, { failOn: 'none' }).rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 80 })
    .toFile(path.join(uploadsDir, rel));
  return rel;
}

export async function downloadImage(url) {
  if (!url) return null;
  try {
    const res = await safeFetch(url, { timeout: 20000, maxBytes: 15 * 1024 * 1024 });
    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/') && !/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url)) return null;
    return await saveImage(res.buffer);
  } catch (err) {
    console.warn('[images] Download fehlgeschlagen:', url, err.message);
    return null;
  }
}

export async function readImageForAi(rel) {
  const buf = await fs.readFile(path.join(uploadsDir, rel));
  return sharp(buf).resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}

export const imageUrl = (rel) => (rel ? `/uploads/${rel}` : null);
export const thumbUrl = (rel) => (rel ? `/uploads/${rel.replace(/\.webp$/, '.thumb.webp')}` : null);
