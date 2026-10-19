import { load } from 'cheerio';
import { absolute, clean, clipTitle, digest, evidence } from './http.mjs';
import { additionalEnumerators } from './providers/bfi-eye-sfi-channels.mjs';
import { enumerators as nfajNzEnumerators } from './providers/nfaj-nz.mjs';

const makeCandidate = (source, item) => ({ registry_source_id: source.id, title: item.title, display_title: item.title,
  original_title: item.original_title || item.title, alternate_titles: item.alternate_titles || [], countries: item.countries || [],
  director_credit: item.director_credit || null, year: item.year || null, runtime: item.runtime || null,
  source_url: item.source_url, external_id: String(item.external_id || item.source_url),
  external_identifiers: item.external_identifiers || {}, poster_url: item.poster_url || null,
  parser: `catalogue-v2:${source.id}`, ...item });
const unique = (items) => [...new Map(items.map((item) => [item.source_url, item])).values()];
const result = (candidates, completion, extra = {}) => ({ candidates: unique(candidates), status: completion, enumeration_complete: completion === 'ENUMERATED', ...extra });

async function loc(source, http, candidates) {
  let page = 1, expected = null; const seenPages = new Set();
  while (true) {
    const url = `https://www.loc.gov/collections/national-screening-room/?fo=json&at=results,pagination&c=1000&sp=${page}`;
    const { data } = await http.json(url, { intervalMs: 3200 });
    if (!Array.isArray(data.results)) throw new Error('LOC_API_MISSING_RESULTS');
    const signature = digest(data.results.map((item) => item.id).join('|'));
    if (seenPages.has(signature) && data.results.length) return result(candidates, 'SOURCE_PAGINATION_ERROR', { blocker: 'LOC returned a repeated page; contact LC-Labs@loc.gov for documented API access.' });
    seenPages.add(signature); expected = data.pagination?.total ?? expected;
    for (const item of data.results) candidates.push(makeCandidate(source, {
      title: item.title, year: Number(String(item.date).match(/\d{4}/)?.[0]) || null,
      source_url: item.url, external_id: item.id, poster_url: item.image_url?.[0] || null,
      external_identifiers: { loc: item.id }, raw: item,
    }));
    if (!data.pagination || !Number.isFinite(Number(data.pagination.total))) throw new Error('LOC_API_PAGINATION_MISSING');
    if (!data.pagination.next) break;
    if (!data.results.length) throw new Error('LOC_EMPTY_PAGE_BEFORE_END');
    page += 1;
  }
  return result(candidates, unique(candidates).length >= Number(expected) ? 'ENUMERATED' : 'SOURCE_PAGINATION_ERROR', { pages: page, advertised_total: expected, access_method: 'Documented public LOC JSON/YAML API; no bypass. 20 requests/minute limit.' });
}

async function nfb(source, http, candidates) {
  let page = 1, total = null, pages = null; const signatures = new Set(); let fetched = 0;
  while (true) {
    const url = 'https://publicapi.nfb.ca/api/v5/works?' + new URLSearchParams({ subset: 'nfb/public', locale: 'en', category: 'film', include_series_episodes: 'true', size: '100', page: String(page) });
    const { data } = await http.json(url);
    if (!Array.isArray(data.items) || !data.meta?.pagination) throw new Error('NFB_API_PAGINATION_MISSING');
    total = Number(data.meta.pagination.total); pages = Number(data.meta.pagination.pages);
    if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(pages) || pages < 0) throw new Error('NFB_API_PAGINATION_INVALID');
    fetched += data.items.length;
    const signature = digest(data.items.map((item) => item.id).join('|'));
    if (signatures.has(signature) && data.items.length) return result(candidates, 'SOURCE_PAGINATION_ERROR', { blocker: 'NFB repeated a catalogue page.' });
    signatures.add(signature);
    for (const item of data.items) {
      if (item.category !== 'film' || !item.availability?.resource_url) continue;
      candidates.push(makeCandidate(source, { title: item.title, year: item.year, source_url: item.availability.resource_url,
        director_credit: item.directors?.map((person) => `${person.first_name || ''} ${person.last_name || ''}`.trim()).filter(Boolean).join(' / ') || null,
        external_id: item.work_id || item.id, version_id: item.id, external_identifiers: { nfb_work: String(item.work_id || item.id), nfb_version: String(item.id) },
        runtime: Number(item.duration) / 60 || null,
        poster_url: item.jacket ? `https://assets.nfbcdn.ca/medias/norman/${item.jacket}` : null,
        raw: item, listing_evidence: evidence('CATALOGUE', 'https://www.nfb.ca/explore-all-films/', { api: 'publicapi.nfb.ca/api/v5/works', category: item.category, version_id: item.id, work_id: item.work_id }, 'NFB website public API, paginated through advertised final page.'),
      }));
    }
    if (page >= pages) break;
    if (!data.items.length) throw new Error('NFB_EMPTY_PAGE_BEFORE_END');
    page += 1;
  }
  return result(candidates, fetched >= total ? 'ENUMERATED' : 'SOURCE_PAGINATION_ERROR', { pages: page, advertised_total: total, fetched_items: fetched, access_method: 'NFB site-authored public API /api/v5/works, category=film; all advertised pages.' });
}

async function mosfilm(source, http, candidates) {
  const root = 'https://www.mosfilm.ru/cinema/films/';
  const first = await http.request(root); const $ = load(first.body);
  const expected = Number($('.catalog-list__head').text().match(/\d+/)?.[0]) || null;
  const parse = (html) => { const $ = load(html); $('a.catalog-list__card[href]').each((i, node) => {
    const e = $(node); const title = clean(e.find('.card-shiny__title').text());
    if (!title) return;
    candidates.push(makeCandidate(source, { title, source_url: absolute(e.attr('href'), root),
      year: Number(e.find('.card-shiny__bottom span').first().text().match(/\d{4}/)?.[0]) || null,
      poster_url: absolute(e.find('img').attr('data-src'), root), raw: { genre: clean(e.find('.card-shiny__bottom').text()) } }));
  }); };
  parse(first.body); let page = 2; const seen = new Set();
  while (expected === null || unique(candidates).length < expected) {
    const doc = await http.json(`${root}?component_code=catalog-filters&page=${page}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (typeof doc.data.content !== 'string') return result(candidates, 'SOURCE_PAGINATION_ERROR', { blocker: 'Mosfilm catalogue AJAX response lacks content.' });
    const hash = digest(doc.data.content);
    if (seen.has(hash)) return result(candidates, 'SOURCE_PAGINATION_ERROR', { blocker: 'Mosfilm repeated a catalogue page.' });
    seen.add(hash); const before = candidates.length; parse(doc.data.content);
    if (candidates.length === before || (doc.data.btnMore !== true && doc.data.btnMore !== 'true')) break;
    page += 1;
  }
  return result(candidates, expected && unique(candidates).length < expected ? 'SOURCE_PAGINATION_ERROR' : 'ENUMERATED', { pages: page, advertised_total: expected, access_method: 'Official catalogue AJAX component_code=catalog-filters, page; stops only at source end or error.' });
}

async function dfi(source, http, candidates) {
  const url = 'https://www.stumfilm.dk/en/stumfilm/films/all-titles';
  const doc = await http.request(url); const $ = load(doc.body);
  $('a.stumfilm-card[href*="/streaming/film/"]').each((i, node) => {
    const e = $(node); const title = clean(e.find('.stumfilm-card__title').text());
    candidates.push(makeCandidate(source, { title, source_url: absolute(e.attr('href'), url),
      year: Number(e.find('.stumfilm-card__year').text()) || null, runtime: Number(e.find('.stumfilm-card__time').text().match(/[0-9.]+/)?.[0]) || null,
      external_id: e.attr('href').split('/').at(-1), raw: { listing_text: clean(e.text()), listing_url: url } }));
  });
  if (!candidates.length) throw new Error('DFI_ALL_TITLES_EMPTY');
  const incompleteUrl = 'https://www.stumfilm.dk/en/stumfilm/films/incomplete-films';
  const incomplete = await http.request(incompleteUrl); const incompleteIds = new Set(load(incomplete.body)('a.stumfilm-card[href]').map((i,e) => absolute(e.attribs.href, incompleteUrl)).get());
  for (const candidate of candidates) candidate.incomplete = incompleteIds.has(candidate.source_url);
  return result(candidates, 'ENUMERATED', { pages: 2, incomplete_candidates: incompleteIds.size, access_method: 'DFI Danish Silent Film official All titles list; separately identifies Incomplete films.' });
}

async function retina(source, http, candidates) {
  const url = 'https://www.retinalatina.org/wp-admin/admin-ajax.php?action=catalogofilter';
  let page = 0, pages = null, total = null; const signatures = new Set();
  while (true) {
    const doc = await http.json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pais: '', genero: '', duracion: '', page }) });
    const data = doc.data.datos;
    if (!data || typeof data.datos !== 'string') throw new Error('RETINA_CATALOGUE_RESPONSE_INVALID');
    pages = Number(data.paginasresultado); total = Number(data.registros);
    if (!Number.isSafeInteger(pages) || pages < 0 || !Number.isSafeInteger(total) || total < 0) throw new Error('RETINA_PAGINATION_INVALID');
    const signature = digest(data.datos);
    if (signatures.has(signature) && total) throw new Error('RETINA_REPEATED_PAGE');
    signatures.add(signature);
    const $ = load(data.datos);
    $('a[href*="/peliculas/"]').each((i,node) => { const e = $(node); const img = e.closest('.retina_poster').find('img');
      const title = clean(img.attr('title') || img.attr('alt')?.replace(/^Afiche\s+/i, '') || e.attr('title') || e.text());
      if (title) candidates.push(makeCandidate(source, { title, source_url: absolute(e.attr('href'), url), poster_url: absolute(img.attr('src'), url), raw: { listing_page: page } }));
    });
    if (page + 1 >= pages) break;
    page += 1;
  }
  return result(candidates, unique(candidates).length >= total ? 'ENUMERATED' : 'SOURCE_PAGINATION_ERROR', { pages, advertised_total: total, access_method: 'Official catalogo.min.js POST contract catalogofilter; every advertised page.' });
}

async function unam(source, http, candidates) {
  let page = 1, pages = null, total = null; const signatures = new Set();
  while (true) {
    const url = `https://cineenlinea.filmoteca.unam.mx/index.php?rest_route=/wp/v2/cine_en_linea&per_page=100&page=${page}&_fields=id,slug,link,title,content,featured_media`;
    const doc = await http.json(url); const items = doc.data;
    if (!Array.isArray(items)) throw new Error('UNAM_REST_NOT_ARRAY');
    pages = Number(doc.headers['x-wp-totalpages']) || null;
    total = Number(doc.headers['x-wp-total']) || total;
    const signature = digest(items.map((item) => item.id).join('|'));
    if (signatures.has(signature) && items.length) throw new Error('UNAM_REPEATED_PAGE');
    signatures.add(signature);
    for (const item of items) {
      const $ = load(item.content?.rendered || ''); const text = clean($.text());
      const title = clean(item.title?.rendered);
      const credit = text.match(/Dir\.\s*([^/\[]+)\s*\/\s*(\d{4})\s*\/\s*([^/\[]+)\s*\/\s*([0-9.]+)\s*min/iu);
      const rawContent = $.text().replace(/[“”″]/g,'"');
      const videoUrl = rawContent.match(/\[vc_video\s+[^\]]*link\s*=\s*["']?(https?:\/\/[^\s"'\]]+)/i)?.[1] || $('iframe').attr('src');
      candidates.push(makeCandidate(source, { title, source_url: item.link, external_id: String(item.id),
        year: Number(credit?.[2] || text.match(/(?:Año|Year)[:\s]+(\d{4})/iu)?.[1]) || null,
        director_credit: credit?.[1]?.trim() || text.match(/(?:Director|Dirección|Realizador)[:\s]+([^\[\n]+?)(?=\[|País|Año|Duraci|$)/iu)?.[1]?.trim() || null,
        countries: credit?.[3] ? [credit[3].trim()] : [],
        runtime: Number(credit?.[4] || text.match(/(?:Duración|Duracion|Duration)[:\s]+(\d+(?:\.\d+)?)/iu)?.[1]) || null,
        raw: { video_url: videoUrl ? absolute(videoUrl, item.link) : null, description: text.slice(0,3000), featured_media_id: item.featured_media || null },
      }));
    }
    if (!items.length || (pages ? page >= pages : items.length < 100)) break;
    page += 1;
  }
  return result(candidates, total && unique(candidates).length < total ? 'SOURCE_PAGINATION_ERROR' : 'ENUMERATED', { pages: page, advertised_total: total, access_method: 'UNAM official cine_en_linea WordPress REST post type; all pages and total-page headers, HTML-prefix defect handled.' });
}

async function thirtyFive(source, http, candidates) {
  const root = 'https://cms.35mm.online/umbraco/api/content';
  const doc = await http.json(root, { headers: { 'x-origin-url': 'https://35mm.online/' } });
  const categories = (doc.data.compositions?.menu?.mainLinks || []).filter((item) => item.url?.startsWith('/vod/'));
  if (!categories.length) throw new Error('35MM_CATEGORIES_MISSING');
  const addAssets = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'Asset' && value.url?.startsWith('/vod/') && value.title) candidates.push(makeCandidate(source, {
      title: value.title, source_url: absolute(value.url, 'https://35mm.online/'), external_id: String(value.atdId || value.url),
      director_credit: value.showOnBox?.persons?.join(' / ') || null, year: Number(value.subtitle?.match(/\d{4}/)?.[0]) || null,
      runtime: Number(value.duration) / 60 || null, countries: value.subtitle?.split('|')[0]?.trim() ? [value.subtitle.split('|')[0].trim()] : [],
      poster_url: value.image?.url || null, raw: value,
    }));
    for (const item of Object.values(value)) if (item && typeof item === 'object') addAssets(item);
  };
  addAssets(doc.data.content);
  for (const category of categories) {
    const content = await http.json(root, { headers: { 'x-origin-url': `https://35mm.online${category.url}` } });
    addAssets(content.data.content);
    const model = content.data.content?.listView;
    if (!model?.loadItemsEndpoint) throw new Error('35MM_CATEGORY_LISTVIEW_MISSING');
    const filters = Object.fromEntries((model.filters || []).filter((f) => f.type === 4 && f.value?.value).map((f) => [`${f.field}.${f.type}`, f.value.value.join(',')]));
    let page = 1; const seen = new Set();
    while (true) {
      const qs = new URLSearchParams({ page: String(page), limit: '48', ...filters });
      const url = `https://cms.35mm.online/${model.loadItemsEndpoint}?${qs}`;
      const { data } = await http.json(url, { headers: { 'x-origin-url': `https://35mm.online${category.url}` } });
      if (!Array.isArray(data.records) || !Number.isSafeInteger(data.pageCount) || data.pageCount < 0) throw new Error('35MM_SEARCH_RESPONSE_INVALID');
      const signature = digest(data.records.map((item) => item.url).join('|'));
      if (seen.has(signature) && data.records.length) throw new Error('35MM_REPEATED_PAGE');
      seen.add(signature);
      for (const item of data.records) { if (item.type !== 'Asset' || !item.url?.startsWith('/vod/')) continue;
        candidates.push(makeCandidate(source, { title: item.title, source_url: absolute(item.url, 'https://35mm.online/'),
          external_id: String(item.atdId || item.url), director_credit: item.showOnBox?.persons?.join(' / ') || null,
          year: Number(item.subtitle?.match(/\d{4}/)?.[0]) || null, runtime: Number(item.duration) / 60 || null,
          countries: item.subtitle?.split('|')[0]?.trim() ? [item.subtitle.split('|')[0].trim()] : [],
          poster_url: item.image?.url || null, raw: item }));
      }
      if (page >= data.pageCount) break;
      if (!data.records.length) throw new Error('35MM_EMPTY_PAGE_BEFORE_END');
      page += 1;
    }
  }
  return result(candidates, candidates.length ? 'ENUMERATED' : 'SOURCE_CATALOGUE_UNAVAILABLE', { access_method: 'Site-authored Umbraco content/listView/search contract; no authentication attempted.' });
}

async function youtubeChannel(source, http, candidates) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return result([], 'SOURCE_API_CREDENTIAL_REQUIRED', { blocker: 'YouTube Data API v3 key required for channels/contentDetails uploads playlist, playlistItems pagination and videos status/contentDetails checks. Public channel RSS is not exhaustive.', access_required: 'Set YOUTUBE_API_KEY (do not commit it). Verify the channel ownership against the registry rights-holder/institution website before publishing.' });
  const handles = { kofa_korean_classic_film: 'KoreanFilm', saina_movies: 'SainaMovies', ap_international: 'APInternational' };
  const api = async (resource, params) => {
    const qs = new URLSearchParams({ ...params, key: apiKey });
    // SourceHttp redacts query strings in its request/evidence log.
    return (await http.json(`https://www.googleapis.com/youtube/v3/${resource}?${qs}`)).data;
  };
  const channel = await api('channels', { part: 'id,snippet,contentDetails', forHandle: handles[source.id] });
  if (channel.items?.length !== 1) throw new Error('YOUTUBE_OFFICIAL_CHANNEL_UNRESOLVED');
  const owner = channel.items[0]; let pageToken = ''; let pages = 0; const tokens = new Set();
  do {
    const batch = await api('playlistItems', { part: 'snippet,contentDetails', playlistId: owner.contentDetails.relatedPlaylists.uploads, maxResults: '50', ...(pageToken ? { pageToken } : {}) });
    const ids = (batch.items || []).map((item) => item.contentDetails?.videoId).filter(Boolean);
    if (ids.length) {
      const detail = await api('videos', { part: 'snippet,contentDetails,status', id: ids.join(',') });
      for (const video of detail.items || []) candidates.push(makeCandidate(source, { title: video.snippet.title,
        source_url: `https://www.youtube.com/watch?v=${video.id}`, external_id: video.id,
        external_identifiers: { youtube_video: video.id }, raw: { video, channel_id: owner.id, channel_name: owner.snippet.title, ownership_review_required: true } }));
    }
    pageToken = batch.nextPageToken || ''; pages += 1;
    if (pageToken && tokens.has(pageToken)) throw new Error('YOUTUBE_REPEATED_PAGE_TOKEN');
    if (pageToken) tokens.add(pageToken);
  } while (pageToken);
  return result(candidates, 'ENUMERATED', { pages, official_channel_id: owner.id, ownership_review_required: true, access_method: 'YouTube Data API v3 uploads playlist; all page tokens.' });
}

async function filmsDivision(source, http) {
  const required = 'The Films Division/NFDC operator must restore a valid TLS certificate and official complete VOD listing/feed/API. Do not use an unauthorized mirror or disable TLS verification.';
  const officialRoots = ['https://filmsdivision.nfdcindia.com/video-on-demand.html', 'https://www.nfdcindia.com/'];
  const failures = [];
  for (const url of officialRoots) {
    try { await http.request(url); } catch (error) { failures.push({ url, code: error.code || 'SOURCE_UNAVAILABLE', message: error.message }); continue; }
    return result([], 'SOURCE_CATALOGUE_UNAVAILABLE', { blocker: 'Official page reachable but no verified replacement VOD/feed contract identified.', access_required: required, attempted: officialRoots });
  }
  return result([], 'SOURCE_UNAVAILABLE', { blocker: failures, access_required: required, attempted: officialRoots });
}

export const enumerators = { loc_national_screening_room: loc, nfb_canada: nfb, mosfilm,
  dfi_danish_silent: dfi, cinematheque_henri: async (source,http,candidates) => {
    const url = 'https://www.cinematheque.fr/henri/'; const doc = await http.request(url); const $ = load(doc.body);
    $('li.film').each((i,node)=>{const e=$(node);const a=e.find('a[href*="film/"]').first();if(!a.length)return;const title=clean(e.find('.titre').clone().find('svg').remove().end().text());const info=clean(e.find('.film-info>div').eq(1).text());const parts=e.find('.duree').text().trim().split(':').map(Number);const seconds=parts.reduce((s,n)=>s*60+n,0);
      candidates.push(makeCandidate(source,{ title, source_url:absolute(a.attr('href'),url), external_id:a.attr('href').match(/film\/(\d+)/)?.[1],
        year:Number(info.match(/(?:,\s*)(\d{4})/)?.[1])||null, director_credit:info.replace(/,?\s*(?:c\.\s*)?\d{4}(?:[-–]\d{4})?\s*$/u,'').trim()||null,
        runtime:seconds/60||null, unavailable:e.hasClass('archived')||/Film indisponible/iu.test(e.text()),
        incomplete:clipTitle(title), poster_url:absolute(e.find('img').attr('src'),url), raw:{expiry_text:clean(e.find('.end').text())},
      }));});
    return result(candidates,'ENUMERATED',{access_method:'HENRI entire published catalogue DOM; includes optional HTML closing tags, archived and expiring entries, no 43-card parser shortcut.'});
  }, retina_latina: retina, filmoteca_unam: unam, '35mm_online': thirtyFive,
  kofa_korean_classic_film: youtubeChannel, saina_movies: youtubeChannel, ap_international: youtubeChannel, films_division_india_vod: filmsDivision,
  ...additionalEnumerators, ...nfajNzEnumerators };

export async function enumerateSource(source, http) {
  const run = enumerators[source.id];
  if (!run) return result([], 'SOURCE_ADAPTER_UNAVAILABLE', { blocker: 'No audited source-specific enumeration contract.' });
  const candidates = [...(http.enumerationCandidates || [])];
  try { return await run(source, http, candidates); }
  catch (error) { return result(candidates, error.code || 'SOURCE_CATALOGUE_ERROR', { blocker: error.message, failed_url: error.url, http_status: error.status, access_required: source.id === 'loc_national_screening_room' ? 'LOC public JSON/YAML API access for this client/network; contact LC-Labs@loc.gov. No keys needed; rate limit 20/minute, CAPTCHA/403 respected.' : 'Provider must supply an accessible official catalogue/API contract or resolve the reported access error.' }); }
}
