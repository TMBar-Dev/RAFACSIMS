import { LIVE_ADMIN } from './account-admin.js';
import { fail, text } from './management.js';

export const BRANDING_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS branding_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    name TEXT NOT NULL,
    short_name TEXT NOT NULL,
    about_us TEXT NOT NULL
  )`,
  // Only two bounded images are stored here. Separate rows keep metadata
  // reads small and let a replacement commit without disturbing the other slot.
  `CREATE TABLE IF NOT EXISTS branding_images (
    slot TEXT PRIMARY KEY CHECK(slot IN ('logo', 'cover')),
    media_type TEXT NOT NULL CHECK(media_type IN ('image/png', 'image/jpeg')),
    content TEXT NOT NULL,
    revision TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS branding_image_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot TEXT NOT NULL CHECK(slot IN ('logo', 'cover')),
    media_type TEXT NOT NULL,
    content TEXT NOT NULL,
    revision TEXT NOT NULL,
    UNIQUE(slot, revision)
  )`
];

const imageLimits = {
  logo: { bytes: 128 * 1024, dimension: 1024 },
  cover: { bytes: 512 * 1024, dimension: 2560 }
};

const imageUrl = (slot, revision) => `/api/branding/${slot}?v=${revision}`;

function imageBytes(content) {
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < bytes.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function brandingImageSlot(path) {
  return /^\/api\/branding\/(logo|cover)$/.exec(path)?.[1];
}

export function brandingBodyLimit(slot) {
  return Math.ceil(imageLimits[slot].bytes / 3) * 4 + 256;
}

export async function readBrandingUpload(request, maxBytes) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let content = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return content + decoder.decode();
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        fail('Request too large.', 413);
      }
      content += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

export async function readBranding(db, includeAbout = false) {
  const settings = await db.prepare(`SELECT name, short_name AS shortName${includeAbout ? ', about_us AS aboutUs' : ''}
    FROM branding_settings WHERE id = 1`).first();
  const images = await db.prepare(`SELECT i.slot, i.revision,
    (SELECT h.revision FROM branding_image_history h WHERE h.slot = i.slot AND h.revision != i.revision
      ORDER BY h.id DESC LIMIT 1) AS previous_revision
    FROM branding_images i`).all();
  return {
    name: 'RAFACSIMS',
    shortName: 'RAFACSIMS',
    ...(includeAbout && { aboutUs: '' }),
    ...settings,
    logoUrl: null,
    coverUrl: null,
    ...Object.fromEntries(images.results.flatMap(image => [
      [`${image.slot}Url`, imageUrl(image.slot, image.revision)],
      [`${image.slot}FallbackUrl`, image.previous_revision ? imageUrl(image.slot, image.previous_revision) : null]
    ]))
  };
}

export async function readAbout(db) {
  const row = await db.prepare('SELECT about_us AS aboutUs FROM branding_settings WHERE id = 1').first();
  return row ?? { aboutUs: '' };
}

export async function saveBranding(db, actor, body) {
  const name = text(body.name, 'System name', 100, true);
  const shortName = text(body.shortName, 'Short name', 32, true);
  const about = text(body.aboutUs ?? '', 'About Us', 2000);
  const row = await db.prepare(`INSERT INTO branding_settings (id, name, short_name, about_us)
    SELECT 1, ?, ?, ? WHERE ${LIVE_ADMIN}
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, short_name = excluded.short_name, about_us = excluded.about_us
    RETURNING id`).bind(name, shortName, about, actor.token_hash).first();
  if (!row) fail('Your administrator session changed. Sign in again.', 403);
  return { name, shortName, aboutUs: about };
}

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});

function pngDimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width, height, hasData = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const end = offset + 8 + length;
    if (end + 4 > bytes.length || !/^[A-Za-z]{4}$/.test(type)) return null;
    let crc = 0xffffffff;
    for (let index = offset + 4; index < end; index++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[index]) & 255];
    if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(end)) return null;
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13) return null;
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[bytes[offset + 17]]?.includes(bytes[offset + 16]) ||
          bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) return null;
    } else if (type === 'IHDR') return null;
    if (type === 'IDAT' && length) hasData = true;
    if (type === 'IEND') return hasData && length === 0 && end + 4 === bytes.length ? { width, height } : null;
    offset = end + 4;
  }
  return null;
}

function jpegDimensions(bytes) {
  let offset = 2, dimensions, hasScan = false;
  let hasQuantization = false, hasHuffman = false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset < bytes.length && bytes[offset++] === 0xff) {
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) return hasScan && hasQuantization && hasHuffman && offset === bytes.length ? dimensions : null;
    if (offset + 2 > bytes.length || marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7))
      return null;
    const length = view.getUint16(offset);
    const end = offset + length;
    if (length < 2 || end > bytes.length) return null;
    if (marker === 0xdb && length >= 67) hasQuantization = true;
    if (marker === 0xc4 && length >= 19) hasHuffman = true;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (dimensions || length < 11 || bytes[offset + 2] !== 8 ||
          ![1, 3, 4].includes(bytes[offset + 7]) || length !== 8 + 3 * bytes[offset + 7]) return null;
      dimensions = { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) };
    }
    if (marker === 0xda) {
      if (!dimensions || length < 8 || length !== 6 + 2 * bytes[offset + 2]) return null;
      offset = end;
      // Skip escaped bytes and restart markers in the compressed scan.
      while (offset < bytes.length) {
        if (bytes[offset++] !== 0xff) continue;
        const next = bytes[offset];
        if (next !== 0 && !(next >= 0xd0 && next <= 0xd7)) { offset--; break; }
        offset++;
      }
      if (offset === end) return null;
      hasScan = true;
    } else offset = end;
  }
  return null;
}

function decodeImage(content, slot) {
  const max = imageLimits[slot];
  if (typeof content !== 'string' || !content.length || content.length % 4 ||
      content.length > Math.ceil(max.bytes / 3) * 4 || !/^[a-z0-9+/]+={0,2}$/i.test(content))
    fail('Choose a PNG or JPEG within the upload size limit.');
  const bytes = imageBytes(content);
  if (bytes.length > max.bytes) fail('The image exceeds the upload size limit.', 413);
  const isPng = pngSignature.every((value, index) => bytes[index] === value);
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const size = isPng ? pngDimensions(bytes) : isJpeg ? jpegDimensions(bytes) : null;
  if (!size?.width || !size.height) fail('Choose a valid PNG or JPEG image.');
  if (size.width > max.dimension || size.height > max.dimension)
    fail(`Image width and height must each be at most ${max.dimension} pixels.`);
  return isPng ? 'image/png' : 'image/jpeg';
}

export async function saveBrandingImage(db, actor, slot, body) {
  if (body.restore === true) {
    const revision = typeof body.revision === 'string' && /^[a-f0-9-]{36}$/i.test(body.revision) ? body.revision : null;
    if (!revision) fail('Choose a saved image revision.');
    const saved = await db.prepare(`UPDATE branding_images SET
      (media_type, content, revision) = (SELECT media_type, content, revision FROM branding_image_history
        WHERE slot = ? AND revision = ?)
      WHERE slot = ? AND EXISTS (SELECT 1 FROM branding_image_history WHERE slot = ? AND revision = ?)
        AND ${LIVE_ADMIN} RETURNING revision`).bind(slot, revision, slot, slot, revision, actor.token_hash).first();
    if (!saved) fail('The previous image or your administrator session is unavailable.', 409);
    return { [`${slot}Url`]: imageUrl(slot, saved.revision), [`${slot}FallbackUrl`]: null };
  }
  const type = decodeImage(body.content, slot);
  const revision = crypto.randomUUID();
  // Archive the previous bytes in the same transaction. If an uploaded
  // image passes format checks but fails to render, a previous revision is
  // still available to browsers and administrators.
  const [, result, , fallback] = await db.batch([
    db.prepare(`INSERT INTO branding_image_history (slot, media_type, content, revision)
      SELECT slot, media_type, content, revision FROM branding_images WHERE slot = ? AND ${LIVE_ADMIN}
      ON CONFLICT(slot, revision) DO NOTHING`).bind(slot, actor.token_hash),
    db.prepare(`INSERT INTO branding_images (slot, media_type, content, revision)
      SELECT ?, ?, ?, ? WHERE ${LIVE_ADMIN}
      ON CONFLICT(slot) DO UPDATE SET media_type = excluded.media_type, content = excluded.content,
        revision = excluded.revision RETURNING slot`).bind(slot, type, body.content, revision, actor.token_hash),
    db.prepare(`DELETE FROM branding_image_history WHERE slot = ? AND id NOT IN (
      SELECT id FROM branding_image_history WHERE slot = ? ORDER BY id DESC LIMIT 3)
      AND EXISTS (SELECT 1 FROM branding_images WHERE slot = ? AND revision = ?)`).bind(slot, slot, slot, revision),
    db.prepare('SELECT revision FROM branding_image_history WHERE slot = ? ORDER BY id DESC LIMIT 1').bind(slot)
  ]);
  const saved = result.results[0];
  if (!saved) fail('Your administrator session changed. Sign in again.', 403);
  const previous = fallback.results[0];
  return { [`${slot}Url`]: imageUrl(slot, revision), [`${slot}FallbackUrl`]: previous ? imageUrl(slot, previous.revision) : null };
}

export async function serveBrandingImage(db, slot, revision = null) {
  const image = await db.prepare(`SELECT media_type, content FROM branding_images WHERE slot = ?
    AND (? IS NULL OR revision = ?) UNION ALL SELECT media_type, content FROM branding_image_history
    WHERE slot = ? AND revision = ? LIMIT 1`).bind(slot, revision, revision, slot, revision).first();
  if (!image) fail('Image not found.', 404);
  return new Response(imageBytes(image.content), {
    headers: {
      'Content-Type': image.media_type,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'no-store'
    }
  });
}
