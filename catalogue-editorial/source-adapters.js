import { SourceRegistry } from './source-model.js';

export const SOURCE_ADAPTER_VERSION = '1.0.0';
export const REQUEST_USER_AGENT = 'GlobalCinemaSourceRegistry/1.0 (+legitimate-source-research)';

const rootListing = (registryId, urls, parser, options = {}) => ({
  registryId,
  urls,
  parser,
  pagination: options.pagination || 'none',
  notes: options.notes || '',
});

// These are discovery adapters, not a rights shortcut. Parsers emit candidates into staging;
// the ingestion command applies the SourceRegistry hard gate before anything can be public.
export const P0_ADAPTERS = [
  rootListing('loc_national_screening_room', [
    'https://www.loc.gov/collections/national-screening-room/?fo=json&c=100',
  ], 'loc-json', { pagination: 'loc-json-sp' }),
  rootListing('nfb_canada', [
    'https://www.nfb.ca/films/',
  ], 'nfb-html', { pagination: 'site-defined' }),
  rootListing('mosfilm', [
    'https://www.mosfilm.ru/movies/',
  ], 'mosfilm-html', { pagination: 'site-defined' }),
  rootListing('kofa_korean_classic_film', [
    'https://eng.koreafilm.or.kr/pages/PC_00000134',
    'https://www.kmdb.or.kr/vod',
  ], 'kofa-html', { pagination: 'site-defined', notes: 'KOFA landing page points to KMDb VOD; title-level verification is required.' }),
  rootListing('dfi_danish_silent', [
    'https://www.dfi.dk/en/english/discover-golden-age-danish-silent-films',
  ], 'dfi-html'),
  rootListing('cinematheque_henri', [
    'https://www.cinematheque.fr/henri/',
  ], 'henri-html', { pagination: 'page-includes-current-programme' }),
  rootListing('retina_latina', [
    'https://www.retinalatina.org/',
  ], 'retina-html', { pagination: 'site-defined' }),
  rootListing('filmoteca_unam', [
    'https://www.filmoteca.unam.mx/cine-en-linea-de-filmoteca-unam/',
  ], 'filmoteca-html', { pagination: 'site-defined' }),
  rootListing('35mm_online', [
    'https://35mm.online/',
  ], '35mm-html', { pagination: 'site-defined' }),
  rootListing('films_division_india_vod', [
    'https://filmsdivision.nfdcindia.com/video-on-demand.html',
  ], 'films-division-html', { pagination: 'site-defined' }),
  rootListing('saina_movies', [
    'https://www.youtube.com/@SainaMovies',
    'https://sainavideo.com/services/',
  ], 'rights-holder-youtube', { pagination: 'youtube-channel' }),
  rootListing('ap_international', [
    'https://www.youtube.com/@APInternational',
    'https://www.apinternationalfilms.com/about',
  ], 'rights-holder-youtube', { pagination: 'youtube-channel' }),
];

const decodeEntities = (value = '') => String(value)
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));

const stripTags = (value = '') => decodeEntities(String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
const absoluteUrl = (value, base) => {
  try { return new URL(value, base).toString(); } catch { return null; }
};
const cleanTitle = (value) => stripTags(value).replace(/[\s|]+$/g, '').trim();
const durationToMinutes = (value) => {
  const match = String(value || '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1] || 0) * 60 + Number(match[2]) + Number(match[3]) / 60;
};

function htmlLinks(html, baseUrl) {
  const links = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const attrs = match[1];
    const href = attrs.match(/\bhref\s*=\s*["']?([^\s"'>]+)/i)?.[1];
    if (!href) continue;
    links.push({ href: absoluteUrl(href, baseUrl), text: stripTags(match[2]), attrs, html: match[2] });
  }
  return links.filter((item) => item.href);
}

function parseHenri(html, baseUrl, registrySource) {
  const candidates = [];
  const itemPattern = /<li\s+class=(?:"film(?:\s+archived)?"|film)[^>]*>\s*<a\s+href=(?:["']?)([^\s"'>]+)(?:["']?)[^>]*>([\s\S]*?)<\/a>\s*<\/li>(?=\s*<li\s+class=|\s*<\/ul>)/gi;
  for (const match of html.matchAll(itemPattern)) {
    const block = match[2];
    const href = absoluteUrl(match[1], baseUrl);
    const unavailable = /Film indisponible|class=(?:"|')?end(?:"|')?/i.test(block) || /class=(?:"|')?film\s+archived/i.test(match[0]);
    const title = cleanTitle(block.match(/<div\s+class=titre[^>]*>([\s\S]*?)<\/div>/i)?.[1] || block.match(/<img[^>]*\balt=["']([^"']+)/i)?.[1]);
    const durationText = stripTags(block.match(/<div\s+class=duree[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');
    const metadata = cleanTitle(block.match(/<div\s+class=film-info[^>]*>[\s\S]*?<div\s+class=titre[^>]*>[\s\S]*?<\/div>\s*<div[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');
    const yearMatch = metadata?.match(/(?:^|,\s*)(\d{4})(?:$|[-,])/u);
    const year = yearMatch?.[1] ? Number(yearMatch[1]) : null;
    const directorCredit = metadata ? metadata.replace(/,?\s*\d{4}(?:[-–]\d{4})?\s*$/u, '').trim() : null;
    if (!title || !href) continue;
    candidates.push({
      external_id: href.match(/film\/(\d+)-/)?.[1] || href,
      title,
      display_title: title,
      director_credit: directorCredit || null,
      year,
      runtime: durationToMinutes(durationText),
      source_url: href,
      poster_url: absoluteUrl(block.match(/<img[^>]*\bsrc=["']?([^\s"'>]+)/i)?.[1], baseUrl),
      full_film_evidence: unavailable ? null : 'Official HENRI current programme item has duration and an active film entry.',
      unavailable_reason: unavailable ? 'Source marks this item unavailable or archived.' : null,
      registry_source_id: registrySource.id,
      parser: 'henri-html',
    });
  }
  return candidates;
}

function parseLocJson(body, baseUrl, registrySource) {
  let payload;
  try { payload = JSON.parse(body); } catch { return []; }
  const items = Array.isArray(payload?.results) ? payload.results : [];
  return items.map((item) => ({
    external_id: item.id || item.url,
    title: cleanTitle(item.title),
    display_title: cleanTitle(item.title),
    year: Number(String(item.date || '').match(/\d{4}/)?.[0]) || null,
    source_url: absoluteUrl(item.url || item.id, baseUrl),
    poster_url: item.resources?.find((resource) => /image/i.test(resource?.title || resource?.format || ''))?.url || null,
    full_film_evidence: null,
    unavailable_reason: null,
    registry_source_id: registrySource.id,
    parser: 'loc-json',
    raw_identifier: item.id || null,
  })).filter((item) => item.title && item.source_url);
}

function parseGenericHtml(html, baseUrl, registrySource, parser) {
  const links = htmlLinks(html, baseUrl);
  const allowed = links.filter((link) => link.href && !/mailto:|javascript:|#/.test(link.href) && link.text && link.text.length > 1);
  const seen = new Set();
  return allowed.map((link) => {
    const key = link.href;
    if (seen.has(key)) return null;
    seen.add(key);
    return {
      external_id: key,
      title: cleanTitle(link.text),
      display_title: cleanTitle(link.text),
      year: null,
      source_url: key,
      poster_url: null,
      full_film_evidence: null,
      unavailable_reason: null,
      registry_source_id: registrySource.id,
      parser,
    };
  }).filter(Boolean);
}

function parseRightsHolder(html, baseUrl, registrySource) {
  return parseGenericHtml(html, baseUrl, registrySource, 'rights-holder-youtube')
    .filter((candidate) => /youtube\.com|youtu\.be/i.test(candidate.source_url));
}

export function getP0Adapter(registrySourceId) {
  return P0_ADAPTERS.find((adapter) => adapter.registryId === registrySourceId) || null;
}

export function getRegisteredP0Adapters(registry) {
  const sourceIds = new Set(registry.p0().map((source) => source.id));
  const rightsIds = new Set(registry.rights_holder_channels.filter((source) => source.priority === 'P0').map((source) => source.id));
  return P0_ADAPTERS.filter((adapter) => sourceIds.has(adapter.registryId) || rightsIds.has(adapter.registryId));
}

export async function fetchDocument(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 30000);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': REQUEST_USER_AGENT, accept: options.accept || 'text/html,application/json;q=0.9,*/*;q=0.5' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const body = await response.text();
    return { ok: response.ok, status: response.status, finalUrl: response.url, body, contentType: response.headers.get('content-type') || '', error: null };
  } catch (error) {
    return { ok: false, status: 0, finalUrl: url, body: '', contentType: '', error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timeout);
  }
}

export function parseAdapterDocument(adapter, body, url, registrySource) {
  if (adapter.parser === 'loc-json') return parseLocJson(body, url, registrySource);
  if (adapter.parser === 'henri-html') return parseHenri(body, url, registrySource);
  if (adapter.parser === 'rights-holder-youtube') return parseRightsHolder(body, url, registrySource);
  return parseGenericHtml(body, url, registrySource, adapter.parser);
}

export function createSourceRegistry(registryJson) {
  return new SourceRegistry(registryJson);
}
