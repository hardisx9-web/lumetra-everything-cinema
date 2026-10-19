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
export function fallbackFilmImage(film) {
  const source = String(film?.id || filmTitle(film));
  let hash = 2166136261;
  for (const char of source) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return `/visuals/film-moods/${String(hash % 32).padStart(2, '0')}.svg`;
}

export const viewingStatus = (film) => film.embedded ? 'Verified embed' : film.watchable ? 'Official external viewing' : 'Catalogue record · no verified playback';
export const artworkLabel = (image) => ({ POSTER: 'Film poster', STILL: 'Film still', FILM_STILL: 'Film still', PRODUCTION_STILL: 'Production still', PRODUCTION_PHOTOGRAPH: 'Production photograph', LOBBY_CARD: 'Lobby card', TITLE_CARD: 'Film title card' })[String(image?.artwork_type).toUpperCase()] || (image ? 'Verified film artwork' : 'Original editorial film illustration · not a historical poster');

// Designed illustrative covers are deliberately different from original film artwork.
// Their geometry is stable for each catalogue ID; they never imply a historical still.
function coverStyle(film) {
  const source = String(film?.id || filmTitle(film));
  let hash = 2166136261;
  for (const char of source) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const colors = [
    ['#daaa66','#423020','#111d27'], ['#92bfb3','#143e3c','#151a28'],
    ['#d6b7ad','#613647','#181a25'], ['#91a6d4','#26365d','#161c2b'],
    ['#e1bca4','#6c3626','#1f212c'], ['#b8be85','#414d28','#162528'],
    ['#beb3e5','#39315b','#171b32'], ['#db9d84','#57322f','#1d2b34']
  ];
  const [accent,mid,dark] = colors[hash % colors.length];
  return { motif: ['eclipse','architecture','horizon','radiance','film','tide','prism','orbit'][hash % 8],accent,mid,dark,index:(hash%97)+1 };
}

export function posterMarkup(film, legacyMap = {}, className = '') {
  const image = artworkFor(film, legacyMap);
  const name = filmTitle(film);
  const sources = image ? Object.entries(image.variants).map(([width, url]) => `${escapeHtml(url)} ${width}w`).join(', ') : '';
  const treatment = coverStyle(film);
  const visuallyAlternative = `<span class="poster-illustration motif-${treatment.motif}" aria-hidden="true"><img class="poster-visual-fallback" src="${escapeHtml(fallbackFilmImage(film))}" alt="" decoding="async" loading="lazy"><i class="poster-symbol"></i><i class="poster-geometry"></i><i class="poster-filmline"></i></span>`;
  return `<div class="poster ${image ? 'has-artwork' : 'no-image'} ${escapeHtml(className)}" style="--cover-accent:${treatment.accent};--cover-mid:${treatment.mid};--cover-dark:${treatment.dark}"><div class="poster-title-treatment">${visuallyAlternative}<span class="title-treatment-kicker">LUMETRA / FRAME ${String(treatment.index).padStart(2,'0')}</span><strong>${escapeHtml(name)}</strong>${film.original_title && film.original_title !== name ? `<span class="cover-original-title">${escapeHtml(film.original_title)}</span>` : ''}<span class="title-treatment-meta">${escapeHtml(filmMetadata(film))}</span><small>Original editorial film illustration · not a historical poster</small></div>${image ? `<img src="${escapeHtml(image.variants['640'] || image.url)}"${sources ? ` srcset="${sources}"` : ''} sizes="(max-width:720px) 44vw, 320px" alt="${escapeHtml(image.alt || `${artworkLabel(image)} for ${name}`)}" loading="lazy" width="640" height="960" data-film-artwork>` : ''}<span class="artwork-kind">${escapeHtml(artworkLabel(image))}</span></div>`;
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
