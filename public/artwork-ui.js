// DOM-free presentation helpers shared by every film surface.
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export function imageUrl(value) {
  if (typeof value !== 'string' || !value || /[\s\\]/.test(value)) return '';
  if (/^\/(?!\/)/.test(value)) return value;
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
}

export function verifiedArtwork(image) {
  if (!image || !image.verified_at) return null;
  const checkedAt = new Date(image.verified_at);
  if (!Number.isFinite(checkedAt.getTime())) return null;
  if (!imageUrl(image.source_page).startsWith('https:') || !image.license || !image.attribution || !imageUrl(image.license_url).startsWith('https:')) return null;
  if (image.verification_status && image.verification_status !== 'VERIFIED') return null;
  if (image.review_status && image.review_status !== 'APPROVED') return null;
  if (image.health_status && image.health_status !== 'HEALTHY') return null;
  const variants = Object.fromEntries(Object.entries(image.variants || {}).filter(([width, url]) => /^[1-9]\d{1,3}$/.test(width) && imageUrl(url)).map(([width, url]) => [width, imageUrl(url)]));
  const url = imageUrl(image.url || image.image_url) || variants['640'] || Object.values(variants)[0];
  return url ? { ...image, verified_at: checkedAt.toISOString(), url, variants } : null;
}

export function artworkFor(film, legacyMap = {}) {
  // An explicit API decision (including null/invalid) must never be replaced by stale legacy art.
  return film && Object.hasOwn(film, 'artwork') ? verifiedArtwork(film.artwork) : verifiedArtwork(legacyMap[film?.id]);
}

export const filmTitle = (film) => film?.displayTitle || film?.title || 'Untitled catalogue record';
export const filmMetadata = (film) => [film.year || 'Date unresolved', film.director || 'Filmmaker unresolved', (film.countries || []).join(' / ') || 'Country unresolved'].join(' · ');
export const viewingStatus = (film) => film.embedded ? 'Verified embed' : film.watchable ? 'Official external viewing' : 'Catalogue record · no verified playback';
export const artworkLabel = (image) => ({ POSTER: 'Film poster', STILL: 'Film still', FILM_STILL: 'Film still', PRODUCTION_STILL: 'Production still', PRODUCTION_PHOTOGRAPH: 'Production photograph', LOBBY_CARD: 'Lobby card', TITLE_CARD: 'Film title card' })[String(image?.artwork_type).toUpperCase()] || (image ? 'Verified film artwork' : 'Original metadata title treatment · not a historical poster');

export function posterMarkup(film, legacyMap = {}, className = '') {
  const image = artworkFor(film, legacyMap);
  const name = filmTitle(film);
  const sources = image ? Object.entries(image.variants).map(([width, url]) => `${escapeHtml(url)} ${width}w`).join(', ') : '';
  return `<div class="poster ${image ? 'has-artwork' : 'no-image'} ${escapeHtml(className)}"><div class="poster-title-treatment"><span class="title-treatment-kicker">LUMETRA / CATALOGUE</span><strong>${escapeHtml(name)}</strong>${film.original_title && film.original_title !== name ? `<span>${escapeHtml(film.original_title)}</span>` : ''}<span class="title-treatment-meta">${escapeHtml(filmMetadata(film))}</span><small>Original metadata title treatment · not a historical poster</small></div>${image ? `<img src="${escapeHtml(image.variants['640'] || image.url)}"${sources ? ` srcset="${sources}"` : ''} sizes="(max-width:720px) 44vw, 320px" alt="${escapeHtml(image.alt || `${artworkLabel(image)} for ${name}`)}" loading="lazy" width="640" height="960" data-film-artwork>` : ''}<span class="artwork-kind">${escapeHtml(artworkLabel(image))}</span></div>`;
}

export const PROGRAMME_SECTIONS = ['carousel', 'history', 'featured', 'watch', 'collection'];
export function disjointProgramme(data) {
  if (!data || PROGRAMME_SECTIONS.some((key) => !Array.isArray(data[key]))) throw new Error('Programme response is incomplete');
  const seen = new Set();
  return { ...data, ...Object.fromEntries(PROGRAMME_SECTIONS.map((key) => [key, data[key].filter((film) => {
    if (!film?.id || !film.title || seen.has(film.id)) return false;
    if (key === 'watch' && !film.watchable && !film.embedded) return false;
    seen.add(film.id); return true;
  })])) };
}

export function sessionProgrammeSeed(storage, { day = new Date().toISOString().slice(0, 10), random = Math.random, reshuffle = false } = {}) {
  let existing;
  try { existing = storage?.getItem('lumetra-programming-seed'); } catch { /* private browsing */ }
  if (!reshuffle && existing?.startsWith(`${day}-`)) return existing;
  const seed = `${day}-${random().toString(36).slice(2, 10) || '0'}`;
  try { storage?.setItem('lumetra-programming-seed', seed); } catch { /* keep usable without storage */ }
  return seed;
}

// Only same-origin film images may enter WebGL; DOM images may use verified HTTPS sources.
export function textureImageUrl(url, origin) {
  const safe = imageUrl(url);
  if (!safe) return '';
  try { return new URL(safe, origin).origin === origin ? safe : ''; } catch { return ''; }
}
