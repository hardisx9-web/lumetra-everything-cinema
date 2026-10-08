import { load } from 'cheerio';
import { absolute, checkHls, clean, clipTitle, digest, evidence, normalizeTitle, safeMediaUrl, SourceAccessError } from '../http.mjs';

const NFAJ = 'nfaj_japanese_animation_classics';
const NZ = 'nz_on_screen';
const origins = { [NFAJ]: 'https://animation.filmarchives.jp', [NZ]: 'https://www.nzonscreen.com' };
const ADAPTER = 'nfaj-nz-v1';
const INTERVAL = 1500;
const robotsCache = new WeakMap();
const unique = (items) => [...new Map(items.map((item) => [item.source_url, item])).values()];
const result = (candidates, status, extra = {}) => ({ candidates: unique(candidates), status, enumeration_complete: status === 'ENUMERATED', ...extra });
const candidateFor = (source, item) => ({
  registry_source_id: source.id, title: item.title, display_title: item.title, original_title: item.original_title || item.title,
  alternate_titles: item.alternate_titles || [], countries: item.countries || [], director_credit: item.director_credit || null,
  year: item.year || null, runtime: item.runtime || null, source_url: item.source_url, external_id: String(item.external_id || item.source_url),
  external_identifiers: item.external_identifiers || {}, poster_url: item.poster_url || null, parser: `catalogue-v2:${source.id}`, ...item,
});
const fail = (code, url, message = code) => { throw new SourceAccessError(code, url, null, message); };
const sameTitle = (a, b) => Boolean(normalizeTitle(a)) && normalizeTitle(a) === normalizeTitle(b);
const add = (record, kind, url, value, method) => record.verification_evidence.push(evidence(kind, safeMediaUrl(url), value, method, record.last_checked_at));
const reject = (record, code, url) => { record.lifecycle_status = 'REJECTED'; record.full_film_verified = false; record.free_verified = false; fail(code, url); };
function official(source, url) {
  try { const value = new URL(url); return value.origin === origins[source.id] && !value.username && !value.password; } catch { return false; }
}

// Use the actual SourceHttp identity, not a browser/crawler impersonation. Longest matching
// robots rule wins (Allow wins ties); a more specific agent group supersedes '*'.
function robotRules(body) {
  const groups = []; let agents = [], rules = [], delay = 0, directives = false;
  const finish = () => { if (agents.length) groups.push({ agents, rules, delay }); agents = []; rules = []; delay = 0; directives = false; };
  for (const line of String(body).split(/\r?\n/u)) {
    const match = line.replace(/#.*/u, '').trim().match(/^([^:]+):\s*(.*)$/u);
    if (!match) continue;
    const name = match[1].trim().toLowerCase(), value = match[2].trim();
    if (name === 'user-agent') { if (directives) finish(); agents.push(value.toLowerCase()); }
    else if (agents.length) {
      directives = true;
      if ((name === 'allow' || name === 'disallow') && value) rules.push({ allow: name === 'allow', path: value });
      if (name === 'crawl-delay' && Number(value) > 0) delay = Number(value) * 1000;
    }
  }
  finish();
  const identity = 'globalcinemasourceregistry';
  const score = (group) => Math.max(-1, ...group.agents.map((agent) => agent === '*' ? 0 : identity.startsWith(agent) ? agent.length : -1));
  const specificity = Math.max(-1, ...groups.map(score));
  const selected = groups.filter((group) => score(group) === specificity && specificity >= 0);
  return { rules: selected.flatMap((group) => group.rules), delay: Math.max(INTERVAL, ...selected.map((group) => group.delay)) };
}
function robotsAllow(rules, url) {
  const target = new URL(url); const path = target.pathname + target.search; let winner = null;
  for (const rule of rules) {
    const anchored = rule.path.endsWith('$');
    const pattern = (anchored ? rule.path.slice(0, -1) : rule.path).split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('.*');
    if (!new RegExp(`^${pattern}${anchored ? '$' : ''}`, 'u').test(path)) continue;
    const length = rule.path.replace(/[*$]/gu, '').length;
    if (!winner || length > winner.length || (length === winner.length && rule.allow)) winner = { length, allow: rule.allow };
  }
  return winner?.allow !== false;
}
async function robots(source, http) {
  if (!origins[source.id]) fail('SOURCE_HOST_NOT_IN_AUDITED_CONTRACT', source.official_url);
  let cache = robotsCache.get(http);
  if (!cache) { cache = new Map(); robotsCache.set(http, cache); }
  if (!cache.has(source.id)) cache.set(source.id, (async () => {
    const url = `${origins[source.id]}/robots.txt`;
    try {
      const doc = await http.request(url, { intervalMs: INTERVAL, maxBytes: 250000 });
      if (!official(source, doc.url)) fail('ROBOTS_REDIRECT_OUTSIDE_OFFICIAL_PROVIDER', url);
      if (!/^\s*(?:#|user-agent:|sitemap:|host:|$)/iu.test(doc.body) || /<(?:html|head|body|title|script)\b/iu.test(doc.body)) fail('SOURCE_ROBOTS_UNCONFIRMED', url, 'robots.txt did not return a recognizable robots policy; no catalogue request attempted.');
      return { ...robotRules(doc.body), evidence: evidence('ROBOTS', url, { status: doc.status, sha256: doc.sha256 }, 'Official robots policy checked before catalogue/detail/player access.') };
    } catch (error) {
      if (![404, 410].includes(error.status)) throw error;
      return { rules: [], delay: INTERVAL, evidence: evidence('ROBOTS', url, { status: error.status, absent: true }, 'Official robots.txt is absent (404/410); no access denial ignored.') };
    }
  })());
  return cache.get(source.id);
}
async function request(source, http, url, options = {}) {
  if (!official(source, url)) fail('SOURCE_HOST_NOT_IN_AUDITED_CONTRACT', url);
  const policy = await robots(source, http);
  if (!robotsAllow(policy.rules, url)) fail('SOURCE_ROBOTS_DISALLOWED', safeMediaUrl(url), `Official robots.txt disallows ${new URL(url).pathname}; permission or a permitted official feed is required.`);
  const doc = await http.request(url, { ...options, intervalMs: Math.max(options.intervalMs || 0, policy.delay) });
  if (!official(source, doc.url)) fail('DETAIL_REDIRECT_OUTSIDE_OFFICIAL_PROVIDER', safeMediaUrl(url));
  return doc;
}
async function json(source, http, url) {
  const doc = await request(source, http, url);
  let data;
  try { data = JSON.parse(doc.body); } catch { fail('SOURCE_RESPONSE_NOT_JSON', url); }
  return { ...doc, data };
}
function stateFor(source, http, initial) {
  const saved = http.enumerationState;
  return saved?.adapter === ADAPTER && saved?.source_id === source.id ? structuredClone(saved) : { adapter: ADAPTER, source_id: source.id, pages: 0, ...initial };
}
async function checkpoint(http, state, candidates) {
  http.enumerationState = structuredClone(state);
  if (typeof http.checkpoint === 'function') await http.checkpoint(structuredClone(state), unique(candidates));
}
async function enumeration(source, http, candidates, run) {
  try { return await run(); }
  catch (error) { return result(candidates, error.code || 'SOURCE_CATALOGUE_ERROR', {
    blocker: error.message, failed_url: error.url, http_status: error.status || null,
    enumeration_state: http.enumerationState || null,
    access_required: 'An accessible, robots-permitted official catalogue contract is required. No protection, authentication, rate-limit or geo bypass is attempted.',
  }); }
}
function nfajListingUrl(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.origin !== origins[NFAJ] || url.pathname !== '/en/works' || [...url.searchParams.keys()].some((key) => !['num', 'page'].includes(key))) return null;
  if (url.searchParams.get('num') !== '50') return null;
  const page = Number(url.searchParams.get('page') || '1');
  if (!Number.isSafeInteger(page) || page < 1) return null;
  return `${origins[NFAJ]}/en/works?num=50${page > 1 ? `&page=${page}` : ''}`;
}

/** enumerateNfaj(source, http, candidates=[]). Mutates the supplied resume candidates;
 * returns the standard enumeration result. Checkpoints carry adapter/source_id,
 * pending_urls, visited_urls, candidate_ids, signatures, pages and advertised_pages. */
export async function enumerateNfaj(source, http, candidates = []) {
  return enumeration(source, http, candidates, async () => {
    const state = stateFor(source, http, { pending_urls: [`${origins[NFAJ]}/en/works?num=50`], visited_urls: [], candidate_ids: [], signatures: [], advertised_pages: 1 });
    while (state.pending_urls.length) {
      const url = state.pending_urls[0];
      if (!nfajListingUrl(url)) fail('NFAJ_RESUME_URL_NOT_IN_CATALOGUE', url);
      const doc = await request(source, http, url); const $ = load(doc.body);
      const items = [];
      $('a[href*="/en/works/view/"]').each((_, node) => {
        const element = $(node), sourceUrl = absolute(element.attr('href'), url);
        const id = sourceUrl?.match(/^https:\/\/animation\.filmarchives\.jp\/en\/works\/view\/(\d+)$/u)?.[1];
        const title = clean(element.find('.work-result-heading').text());
        if (!id || !title) return;
        const original = clean(element.find('.work-result-title-en').text());
        const facts = clean(element.find('.work-result-properties').text());
        items.push(candidateFor(source, { title, original_title: original || title, alternate_titles: original ? [original] : [],
          year: Number(facts.match(/Prod\. Year\s*:\s*(\d{4})/u)?.[1]) || null,
          director_credit: facts.match(/Dir\.\s*:\s*(.+)$/u)?.[1] || null,
          source_url: sourceUrl, external_id: id, external_identifiers: { nfaj_work: id },
          listing_evidence: evidence('CATALOGUE', url, { sha256: doc.sha256, work_id: id, page: Number(new URL(url).searchParams.get('page') || 1) }, 'Official List of Works, unfiltered 50-item UI setting; all linked pagination pages.'),
          raw: { listing_url: url, listing_text: facts },
        }));
      });
      if (!items.length || items.length !== $('.work-result-heading').length) fail('NFAJ_CATALOGUE_MARKUP_CHANGED_OR_EMPTY', url);
      const signature = digest(items.map((item) => item.external_id).join('|'));
      if (state.signatures.includes(signature)) fail('SOURCE_PAGINATION_ERROR', url, 'NFAJ repeated a nonempty catalogue page; enumeration is incomplete.');
      if (!$('.pager-menu').length) fail('NFAJ_PAGINATION_CONTRACT_MISSING', url);
      const linked = [];
      $('.pager-menu a[href]').each((_, node) => {
        const value = $(node).attr('href'); if (!value) return;
        const next = nfajListingUrl(absolute(value, url));
        if (!next) fail('NFAJ_PAGINATION_LINK_OUTSIDE_CONTRACT', url);
        linked.push(next);
        state.advertised_pages = Math.max(state.advertised_pages, Number(new URL(next).searchParams.get('page') || 1));
      });
      if (items.some((item) => state.candidate_ids.includes(item.external_id))) fail('SOURCE_PAGINATION_ERROR', url, 'NFAJ repeated a work across catalogue pages.');
      candidates.push(...items); state.candidate_ids.push(...items.map((item) => item.external_id)); state.signatures.push(signature); state.visited_urls.push(url); state.pending_urls.shift(); state.pages += 1;
      for (const next of linked) if (!state.visited_urls.includes(next) && !state.pending_urls.includes(next)) state.pending_urls.push(next);
      await checkpoint(http, state, candidates);
    }
    if (!state.pages || state.pages !== state.advertised_pages) fail('SOURCE_PAGINATION_ERROR', `${origins[NFAJ]}/en/works`, 'NFAJ did not reach every advertised catalogue page.');
    const resumedIds = new Set(unique(candidates).map((item) => item.external_id));
    if (!candidates.length || resumedIds.size !== state.candidate_ids.length || state.candidate_ids.some((id) => !resumedIds.has(id))) fail('SOURCE_RESUME_CANDIDATES_MISSING', `${origins[NFAJ]}/en/works`);
    return result(candidates, 'ENUMERATED', { pages: state.pages, enumeration_state: state,
      access_method: 'Official unfiltered /en/works?num=50; traverse all published pager links without a film-count cap. No image/video downloads.' });
  });
}

/** enumerateNzOnScreen(source, http, candidates=[]). Covers both Film and Short film,
 * including officially classified shorts under /all-series/. Checkpoints carry
 * categories, category_index, page_number, page_sizes, totals, category_ids, signatures and pages. */
export async function enumerateNzOnScreen(source, http, candidates = []) {
  return enumeration(source, http, candidates, async () => {
    const filtersUrl = `${origins[NZ]}/api/v3/search/filters`;
    const { data: filters } = await json(source, http, filtersUrl);
    const categories = ['Film', 'Short film'].map((name) => filters.categories?.find((item) => item.display_name === name)?.id);
    if (categories.some((id) => typeof id !== 'string' || !id)) fail('NZ_FILM_CATEGORIES_CONTRACT_MISSING', filtersUrl);
    const state = stateFor(source, http, { categories, category_index: 0, page_number: 1, page_sizes: {}, totals: {}, category_ids: {}, signatures: [] });
    if (JSON.stringify(state.categories) !== JSON.stringify(categories)) fail('NZ_RESUME_CATEGORY_CONTRACT_CHANGED', filtersUrl);
    while (state.category_index < categories.length) {
      const category = categories[state.category_index];
      const url = `${origins[NZ]}/api/v3/search/?${new URLSearchParams({ q: '', media_category: category, page_number: String(state.page_number), sort: 'title' })}`;
      const { data, ...doc } = await json(source, http, url); const p = data.pagination;
      if (!Array.isArray(data.results) || !p || p.page_number !== state.page_number || !Number.isSafeInteger(p.page_size) || p.page_size < 0 || !Number.isSafeInteger(p.total_count) || p.total_count < 0 || (p.total_count > 0 && p.page_size === 0)) fail('NZ_SEARCH_PAGINATION_INVALID', url);
      if (state.totals[category] !== undefined && state.totals[category] !== p.total_count) fail('NZ_CATALOGUE_CHANGED_DURING_ENUMERATION', url);
      state.totals[category] = p.total_count;
      state.page_sizes[category] ??= p.page_size;
      const ids = state.category_ids[category] || []; const items = [];
      // The current API reports the actual last-page count as page_size (14 for
      // Film page 31), not the nominal 20-record capacity. Stop by unique total,
      // not page_number * last-page page_size; page 32 otherwise reports -6.
      const expected = Math.min(state.page_sizes[category], Math.max(0, p.total_count - ids.length));
      if (data.results.length !== expected || ![state.page_sizes[category], expected].includes(p.page_size)) fail('SOURCE_PAGINATION_ERROR', url, 'NZ On Screen returned a premature empty/short page or more records than its pagination advertises.');
      const signature = `${category}:${digest(data.results.map((item) => item.id).join('|'))}`;
      if (data.results.length && state.signatures.includes(signature)) fail('SOURCE_PAGINATION_ERROR', url, 'NZ On Screen repeated a nonempty catalogue page.');
      for (const item of data.results) {
        const canonical = absolute(item.html_url, origins[NZ]);
        if (!official(source, canonical) || !/^\/(?:videos|all-series)\/.+\/$/u.test(new URL(canonical).pathname) || !clean(item.title) || item.id == null || !['Film', 'Short film'].includes(item.media_type_category)) fail('NZ_SEARCH_ITEM_CONTRACT_INVALID', url);
        const id = String(item.id);
        if (ids.includes(id)) fail('SOURCE_PAGINATION_ERROR', url, 'NZ On Screen repeated an item across pages; total coverage is unconfirmed.');
        ids.push(id);
        items.push(candidateFor(source, { title: clean(item.title), year: Number(item.production?.start_date) || null,
          runtime: Number(item.duration?.raw) / 60 || null, source_url: canonical, external_id: id,
          external_identifiers: { nzonscreen_page: id },
          listing_evidence: evidence('CATALOGUE', url, { sha256: doc.sha256, page_id: item.id, category, page_number: p.page_number, total_count: p.total_count }, 'Site-authored /api/v3/search/ contract from the public search page JavaScript; all Film and Short film pages, including rental/trailer records pending title-specific rejection.'),
          raw: item,
        }));
      }
      candidates.push(...items); state.category_ids[category] = ids; state.signatures.push(signature); state.pages += 1;
      if (ids.length >= p.total_count) {
        if (ids.length !== p.total_count) fail('SOURCE_PAGINATION_ERROR', url, 'NZ On Screen unique title count does not match advertised category total.');
        state.category_index += 1; state.page_number = 1;
      } else state.page_number += 1;
      await checkpoint(http, state, candidates);
    }
    const expected = new Set(Object.values(state.category_ids).flat());
    const resumedIds = new Set(unique(candidates).map((item) => item.external_id));
    if (unique(candidates).length !== expected.size || resumedIds.size !== expected.size || [...expected].some((id) => !resumedIds.has(id))) fail('SOURCE_RESUME_CANDIDATES_MISSING', `${origins[NZ]}/search/`, 'Resume candidates do not cover all discovered catalogue identifiers.');
    return result(candidates, 'ENUMERATED', { pages: state.pages, advertised_totals: state.totals, enumeration_state: state,
      access_method: 'Official public search UI GET /api/v3/search/, categories Film and Short film, sort=title; all advertised pages, no authentication or film-count cap.' });
  });
}

function externalOnly(record) {
  record.embed_status = 'PROHIBITED'; record.embed_working = false; record.embed_url_if_allowed = null;
  record.full_film_verified = false; record.free_verified = false; record.live_check_status = 'PENDING';
}
async function detail(source, candidate, http, record) {
  if (!official(source, candidate.source_url)) fail('SOURCE_HOST_NOT_IN_AUDITED_CONTRACT', candidate.source_url);
  const doc = await request(source, http, candidate.source_url); const $ = load(doc.body);
  const title = clean($('h1').first().text()) || (source.id === NZ ? clean($('h3').first().text()) : '');
  if (!title || ![candidate.title, candidate.original_title, ...(candidate.alternate_titles || [])].some((name) => sameTitle(name, title))) fail('DETAIL_TITLE_MISMATCH', candidate.source_url);
  record.http_status = doc.status; record.official_or_rights_verified = true;
  add(record, 'DETAIL', doc.url, { status: doc.status, sha256: doc.sha256, title }, 'Title-matched canonical page on the registered institution domain; HTTP 200 does not establish playback.');
  add(record, 'OFFICIAL', doc.url, { registry_source: source.id, title }, 'Registered institution controls the title-specific page and its player link.');
  const policy = await robots(source, http); record.verification_evidence.push(policy.evidence);
  return { doc, $ };
}
async function officialHls(source, http, record, sourceUrl) {
  if (!official(source, sourceUrl) || !/\.m3u8$/iu.test(new URL(sourceUrl).pathname)) fail('OFFICIAL_HLS_CONTRACT_REQUIRED', record.canonical_source_url);
  // All child playlists and the media HEAD probe use the same robots/host restriction.
  // This is the existing independent gate, not a new HTTP-200 watchability shortcut.
  const check = await checkHls({ request: (url, options) => request(source, http, url, options) }, sourceUrl, record.runtime);
  if (check.evidence) record.verification_evidence.push(check.evidence);
  if (!check.verified) fail(check.reason || 'SOURCE_MEDIA_UNCONFIRMED', record.canonical_source_url);
  record.full_film_verified = true; record.free_verified = true; record.live_check_status = 'PASS';
  add(record, 'FREE', record.canonical_source_url, { public_player: true, authenticated: false, paid: false }, 'Official public HLS passed complete-duration/endlist/unencrypted media HEAD gate; no film downloaded.');
}

/** Verifiers mutate the parent's base record and throw on rejected/pending items.
 * They never finalize watch_state and never grant embedding. Parent verifyCandidate
 * must keep its existing full/free/official/live independent final publication gate. */
export async function verifyNfaj(source, candidate, http, record) {
  externalOnly(record);
  if (candidate.incomplete || clipTitle(candidate.title) || /\b(?:clip|excerpts?)\b/iu.test(candidate.title)) reject(record, 'NOT_COMPLETE_FILM', candidate.source_url);
  if (!/^https:\/\/animation\.filmarchives\.jp\/en\/works\/view\/\d+$/u.test(candidate.source_url)) fail('NFAJ_CANONICAL_WORK_URL_REQUIRED', candidate.source_url);
  const { doc, $ } = await detail(source, candidate, http, record); const facts = {};
  $('table.work-details tr').each((_, node) => { facts[clean($(node).find('th').text())] = clean($(node).find('td').text()); });
  const completeness = facts.Completeness?.toLowerCase();
  add(record, 'FILM_COMPLETENESS', doc.url, { completeness: completeness || null, duration_minutes: facts['Duration (minutes)'] || null }, 'NFAJ title-specific Completeness field, not merely catalogue inclusion.');
  if (completeness && completeness !== 'complete') reject(record, 'NFAJ_INCOMPLETE_FILM', doc.url);
  if (!completeness) fail('NFAJ_FILM_COMPLETENESS_UNKNOWN', doc.url);
  record.metadata.original_title = facts['Original Title'] || candidate.original_title || candidate.title;
  record.metadata.alternate_titles = [...new Set([...(record.metadata.alternate_titles || []), facts['Japanese kana Rendering']].filter(Boolean))];
  record.metadata.director_credit = facts['Credits: Director']?.replace(/^Animation:\s*/u, '') || facts.Author || record.metadata.director_credit;
  record.metadata.year = Number(facts['Production Date']?.match(/\d{4}/u)?.[0]) || record.metadata.year;
  record.runtime = Number(facts['Duration (minutes)']) || null;
  record.version_or_restoration = facts['Source of Digital Copy'] || null;
  if (!(record.runtime > 0)) fail('NFAJ_RUNTIME_UNKNOWN', doc.url);
  const faqUrl = `${origins[NFAJ]}/en/support5.html`; const faq = await request(source, http, faqUrl);
  const faqText = clean(load(faq.body)('body').text());
  if (!/access to the videos free of charge/iu.test(faqText)) fail('NFAJ_CURRENT_FREE_TERMS_UNCONFIRMED', faqUrl);
  add(record, 'FREE_TERMS', faqUrl, { free_streaming_offered: true, embedding: 'PROHIBITED', downloads: 'PROHIBITED', sha256: faq.sha256 }, 'Current official FAQ permits free viewing by website links only; it is not live playback evidence.');
  const id = candidate.source_url.split('/').at(-1);
  const playerUrl = $('a[href]').map((_, node) => absolute($(node).attr('href'), doc.url)).get().find((url) => url === `${origins[NFAJ]}/en/works/playen/${id}` || url === `${origins[NFAJ]}/en/works/play/${id}`);
  if (!playerUrl) fail('NFAJ_OFFICIAL_PLAYER_UNAVAILABLE', doc.url);
  const player = await request(source, http, playerUrl); const p = load(player.body);
  if (!sameTitle(clean(p('h1').first().text()), candidate.title)) fail('NFAJ_PLAYER_IDENTITY_MISMATCH', playerUrl);
  add(record, 'OFFICIAL_PLAYER', playerUrl, { status: player.status, sha256: player.sha256, work_id: id }, 'Official work-specific Watch link; player page alone cannot pass live playback.');
  const media = p('video[src], video source[src]').map((_, node) => absolute(p(node).attr('src'), player.url)).get().find((url) => url && official(source, url) && /\.m3u8$/iu.test(new URL(url).pathname));
  if (media) return officialHls(source, http, record, media);
  const frames = p('iframe[src]').map((_, node) => absolute(p(node).attr('src'), player.url)).get().filter(Boolean);
  add(record, 'PROVIDER_ACCESS_BLOCKER', playerUrl, { player_hosts: [...new Set(frames.map((url) => new URL(url).hostname))], full_film_listing: true, media_requested: false }, 'Observed NFAJ player delegates to h10.cs.nii.ac.jp. That off-registry player has no audited robots/playback contract in this adapter; no request, download or embed permission inferred.');
  fail(frames.length ? 'NFAJ_OFFICIAL_PLAYER_HOST_REVIEW_REQUIRED' : 'NFAJ_FULL_PLAYBACK_CONTRACT_REQUIRED', playerUrl);
}

export async function verifyNzOnScreen(source, candidate, http, record) {
  externalOnly(record);
  if (candidate.incomplete || clipTitle(candidate.title) || /\b(?:clip|excerpts?)\b/iu.test(candidate.title)) reject(record, 'NOT_COMPLETE_FILM', candidate.source_url);
  if (candidate.raw?.media_type_category && !['Film', 'Short film'].includes(candidate.raw.media_type_category)) reject(record, 'NZ_NOT_A_FILM', candidate.source_url);
  const { doc, $ } = await detail(source, candidate, http, record);
  const path = new URL(doc.url).pathname.replace(/^\/+|\/+$/gu, '');
  const url = `${origins[NZ]}/api/v3/pages/find/?${new URLSearchParams({ html_path: path })}`;
  const { data, ...api } = await json(source, http, url);
  if (!sameTitle(data.title, candidate.title) || !official(source, data.meta?.html_url) || new URL(data.meta.html_url).pathname !== new URL(doc.url).pathname || (candidate.external_identifiers?.nzonscreen_page && String(data.id) !== String(candidate.external_identifiers.nzonscreen_page))) fail('NZ_DETAIL_IDENTITY_MISMATCH', url);
  record.metadata.year = Number(data.production?.start_date) || record.metadata.year;
  const directors = data.cast_and_crew?.crew?.filter((person) => person.roles?.some((role) => role.credit_category === 'Director')).map((person) => clean(person.profile?.title)).filter(Boolean) || [];
  if (directors.length) record.metadata.director_credit = directors.join(' / ');
  const video = data.hero_banner?.hero_video;
  add(record, 'TITLE_FILM_CLASSIFICATION', doc.url, { page_id: data.id, media_type_category: data.media_type_category, is_episode: data.is_episode, video_type: video?.video_type || null, video_id: video?.video_id || null, rental: video?.rental || null, sha256: api.sha256 }, 'Current official title API separates film classification from the actual video type and item-specific NZOS+ rental/protection.');
  if (!['Film', 'Short film'].includes(data.media_type_category) || data.is_episode === true) reject(record, 'NZ_NOT_A_FILM', doc.url);
  if (!video) fail('NZ_PUBLIC_TITLE_PLAYER_UNAVAILABLE', doc.url);
  if (video.rental?.is_rental === true || Number(video.rental?.price) > 0) reject(record, 'NZ_PAID_OR_RENTAL', doc.url);
  if (['trailer', 'teaser', 'excerpt', 'clip', 'television', 'episode'].includes(video.video_type) || /\b(?:trailers?|teasers?|excerpts?|clips?)\b/iu.test(`${video.name || ''} ${video.description || ''}`)) reject(record, 'NZ_NOT_COMPLETE_FILM', doc.url);
  if (!['film', 'short_film'].includes(video.video_type)) fail('NZ_FULL_FILM_CLASSIFICATION_UNKNOWN', doc.url);
  if (video.rental?.is_protected === true) fail('NZ_AUTHENTICATED_OR_PROTECTED_PLAYER', doc.url);
  if (video.rental?.is_rental !== false || (video.rental?.price != null && !Number.isFinite(Number(video.rental.price)))) fail('NZ_CURRENT_FREE_STATUS_UNKNOWN', doc.url);
  record.runtime = Number(video.duration?.raw) / 60 || null;
  if (!(record.runtime > 0) || !video.video_id) fail('NZ_FULL_FILM_IDENTITY_OR_RUNTIME_UNKNOWN', doc.url);
  record.metadata.external_identifiers.nzonscreen_video = String(video.video_id);
  add(record, 'FULL_FILM_LISTING', doc.url, { video_type: video.video_type, video_id: video.video_id, duration_minutes: record.runtime, free_listing: true }, 'Official anonymous title API explicitly classifies the actual video as film/short_film and not rental/protected; independent live gate is still mandatory.');
  // A directly published first-party HLS source can use the existing gate. Do not
  // manufacture a Brightcove URL, lift policy keys or request paid playback APIs.
  const boundVideo = $('video[data-video-id]').filter((_, node) => $(node).attr('data-video-id') === String(video.video_id));
  const media = boundVideo.add(boundVideo.find('source[src]')).map((_, node) => absolute($(node).attr('src'), doc.url)).get().find((value) => value && official(source, value) && /\.m3u8$/iu.test(new URL(value).pathname));
  if (media && official(source, media) && /\.m3u8$/iu.test(new URL(media).pathname)) return officialHls(source, http, record, media);
  add(record, 'PROVIDER_ACCESS_BLOCKER', doc.url, { account_id: video.account_id || null, player_id: video.player_id || null, video_id: video.video_id, media_requested: false }, 'Observed current site delegates playback to Brightcove. Public metadata/free flags do not prove playable full media; an audited anonymous official player contract is required. No off-domain requests or authentication performed.');
  fail('NZ_BRIGHTCOVE_FREE_FULL_PLAYBACK_CONTRACT_REQUIRED', doc.url);
}

export const enumerators = { [NFAJ]: enumerateNfaj, [NZ]: enumerateNzOnScreen };
export const verifiers = { [NFAJ]: verifyNfaj, [NZ]: verifyNzOnScreen };
