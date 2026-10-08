import { load } from 'cheerio';
import { absolute, clean, clipTitle, digest, evidence, normalizeTitle, safeMediaUrl } from '../http.mjs';

const candidate = (source, item) => ({ registry_source_id: source.id, title: item.title, display_title: item.title,
  original_title: item.title, alternate_titles: [], countries: [], director_credit: null, year: null, runtime: null,
  external_identifiers: {}, parser: `catalogue-v3:${source.id}`, ...item });
const distinct = items => [...new Map(items.map(item => [item.source_url, item])).values()];
const result = (items, status, extra = {}) => ({ candidates: distinct(items), status, enumeration_complete: status === 'ENUMERATED', ...extra });
const checkpoint = async (http, state, items) => { if (http.checkpoint) await http.checkpoint(state, distinct(items)); };
export const BFI_SEARCH = 'https://search-es.player.bfi.org.uk/prod-films/_search';
const BFI_ORIGIN = 'https://player.bfi.org.uk';
const BFI_CONTRACT = 'bfi-search-free-nid-v1';
const bfiFilmUrl = value => {
  const url = new URL(value, BFI_ORIGIN);
  if (url.origin !== BFI_ORIGIN || url.username || url.password || url.search || url.hash || !/^\/free\/film\/[^/]+\/?$/.test(url.pathname)) throw new Error('BFI_DETAIL_OUTSIDE_FREE_CONTRACT');
  return url.href;
};
const bfiList = value => (Array.isArray(value) ? value : value == null ? [] : [value]).filter(v => typeof v === 'string').map(clean).filter(Boolean);
export function bfiMetadata(m) {
  if (!m || m.pillar !== 'free') throw new Error('BFI_SEARCH_OUTSIDE_FREE_CONTRACT');
  const nid = typeof m.nid === 'string' ? m.nid : '';
  if (!/^[1-9]\d*$/.test(nid)) throw new Error('BFI_NATIVE_ID_INVALID');
  const title = clean(m.title), original = clean(m.original_title) || title;
  if (!title) throw new Error('BFI_TITLE_MISSING');
  if (m.release_date != null && m.release_date !== '' && (!/^\d{4}$/.test(String(m.release_date)) || Number(m.release_date) < 1880 || Number(m.release_date) > 2200)) throw new Error('BFI_RELEASE_DATE_INVALID');
  const directors = bfiList(m.director), runtime = Number(m.duration);
  return { title, display_title: title, original_title: original, alternate_titles: original !== title ? [original] : [],
    year: m.release_date ? Number(m.release_date) : null, director_credit: directors.join(' / ') || null, directors,
    countries: bfiList(m.country), runtime: Number.isFinite(runtime) && runtime > 0 ? runtime : null,
    source_url: bfiFilmUrl(m.url), external_id: nid, external_identifiers: { bfi_nid: nid },
    bfi_nid: nid, bfi_uuid: typeof m.uuid === 'string' ? m.uuid : null,
    genres: bfiList(m.genre), subjects: bfiList(m.subject), archives: bfiList(m.archive), cast: bfiList(m.cast),
    synopsis: clean(m.standfirst), availability: structuredClone(m.availability || null),
    poster_url: absolute(bfiList(m.image)[0], BFI_ORIGIN), raw: { bfi_search: structuredClone(m) },
    parser: 'catalogue-v4:bfi_player_free:structured-search' };
}
async function bfiSearch(http, body) {
  const doc = await http.json(BFI_SEARCH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (doc.url !== BFI_SEARCH || doc.data?.timed_out !== false || doc.data?._shards?.failed !== 0 || doc.data?.hits?.total?.relation !== 'eq' || !Number.isSafeInteger(doc.data.hits.total.value) || doc.data.hits.total.value < 0 || !Array.isArray(doc.data.hits.hits)) throw new Error('BFI_SEARCH_RESPONSE_INVALID');
  return { doc, hits: doc.data.hits.hits, total: doc.data.hits.total.value };
}
const bfiQuery = filters => ({ bool: { filter: [{ term: { 'pillar.raw': 'free' } }, ...filters] } });
async function bfi(source, http, items) {
  const state = http.enumerationState || { contract: BFI_CONTRACT, search_after: null, pages: 0, fetched: 0, total: null };
  if (state.contract !== BFI_CONTRACT) throw new Error('BFI_CHECKPOINT_CONTRACT_CHANGED_NEW_OBSERVATION_REQUIRED');
  const ids = new Set(items.map(item => item.external_identifiers?.bfi_nid));
  const urls = new Set(items.map(item => item.source_url));
  if (state.fetched !== items.length || ids.has(undefined) || ids.size !== items.length || urls.size !== items.length) throw new Error('BFI_RESUME_CANDIDATES_MISSING');
  while (state.total == null || state.fetched < state.total) {
    // nid is a unique keyword: search_after traverses beyond ES's 10,000-result
    // window without from/offset truncation or numeric/date/text sort guesses.
    const { doc, hits, total } = await bfiSearch(http, { size: 500, track_total_hits: true, query: bfiQuery([]), sort: [{ nid: 'asc' }], ...(state.search_after ? { search_after: state.search_after } : {}) });
    if (state.total != null && state.total !== total) throw new Error('BFI_CATALOGUE_CHANGED_DURING_ENUMERATION');
    if (!hits.length && state.fetched < total) throw new Error('BFI_EMPTY_PAGE_BEFORE_END');
    const batch = hits.map(hit => {
      const metadata = bfiMetadata(hit._source);
      if (!Array.isArray(hit.sort) || hit.sort.length !== 1 || hit.sort[0] !== metadata.bfi_nid || (state.search_after && hit.sort[0] <= state.search_after[0]) || ids.has(metadata.bfi_nid) || urls.has(metadata.source_url)) throw new Error('BFI_REPEATED_OR_INVALID_PAGE');
      ids.add(metadata.bfi_nid); urls.add(metadata.source_url);
      return candidate(source, { ...metadata, listing_evidence: evidence('CATALOGUE', BFI_SEARCH,
        { nid: metadata.bfi_nid, uuid: metadata.bfi_uuid, pillar: 'free', response_sha256: doc.sha256, search_after: state.search_after, advertised_total: total },
        'Official BFI structured Elasticsearch metadata; exact pillar.raw=free. Catalogue identity is not full/free/live playback proof.') });
    });
    if (batch.some((item, index) => index && item.bfi_nid <= batch[index - 1].bfi_nid) || state.fetched + batch.length > total) throw new Error('BFI_PAGINATION_INVALID');
    items.push(...batch); state.total = total; state.fetched += batch.length; state.pages++;
    if (hits.length) state.search_after = hits.at(-1).sort;
    await checkpoint(http, state, items);
  }
  return result(items, 'ENUMERATED', { pages: state.pages, advertised_total: state.total, fetched_items: state.fetched,
    catalogue_scope: 'Exact free pillar in the official BFI structured search catalogue, all unique provider nids; may include supplementary/unavailable records.',
    access_method: 'Official public Elasticsearch search_after by keyword nid; robots/access controls enforced. Player /search/ is not crawled.' });
}

const EYE_API = 'https://api.audienceplayer.com/graphql/9/user';
const eyeFields = 'id type name full_url_slug is_auth_required metas { key value } assets { id duration linked_type type accessibility }';
async function eyeQuery(http, query) {
  const doc = await http.json(EYE_API, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Language': 'nl' }, body: JSON.stringify({ query }) });
  if (doc.data.errors?.length) throw new Error(`EYE_PUBLIC_API_ERROR: ${doc.data.errors.map(e => e.message).join('; ')}`);
  return { doc, data: doc.data.data };
}
export function eyeMetadata(article) {
  const m = Object.fromEntries((article.metas || []).map(meta => [meta.key, clean(meta.value)]));
  const full = (article.assets || []).filter(a => a.linked_type === 'film' && a.type === 'video');
  return { title: m.title || article.name, director_credit: m.director || null, year: Number(m.year?.match(/\d{4}/)?.[0]) || null,
    countries: m.country ? m.country.split(/\s*[,;]\s*/) : [], runtime: full.length === 1 ? Number(full[0].duration) / 60 || null : null,
    cost: m.cost || null, audio_languages: m.language ? [m.language] : [], subtitle_languages: m.subtitles ? [m.subtitles] : [], full_assets: full,
    incomplete: /\b(?:fragment|excerpt|trailer|extract|onvolledig)\b/i.test(m.title || article.name) };
}
async function eye(source, http, items) {
  const state = http.enumerationState || { offset: 0, pages: 0, signatures: [], ids: [], film_ids: [] };
  while (state.total == null || state.offset < state.total) {
    const { doc, data } = await eyeQuery(http, `query { ArticleList(limit: 100, offset: ${state.offset}) { pagination { limit offset count total_count page_count } items { ${eyeFields} } } }`);
    const list = data?.ArticleList, p = list?.pagination;
    if (!Array.isArray(list?.items) || !p || !Number.isSafeInteger(p.total_count) || !Number.isSafeInteger(p.count) || p.offset !== state.offset || p.count !== list.items.length) throw new Error('EYE_PAGINATION_INVALID');
    if (state.total != null && state.total !== p.total_count) throw new Error('EYE_CATALOGUE_CHANGED_DURING_ENUMERATION');
    const ids = list.items.map(a => String(a.id));
    const sig = digest(ids.join('|'));
    if ((list.items.length && state.signatures.includes(sig)) || new Set(ids).size !== ids.length || ids.some(id => state.ids.includes(id))) throw new Error('EYE_REPEATED_PAGE');
    state.signatures.push(sig); state.ids.push(...ids);
    for (const article of list.items) {
      if (article.type !== 'film' || !article.full_url_slug?.startsWith('films/')) continue;
      const m = eyeMetadata(article); state.film_ids.push(String(article.id));
      items.push(candidate(source, { ...m, source_url: `https://player.eyefilm.nl/nl/${article.full_url_slug}`, external_id: String(article.id),
        external_identifiers: { eye_article: String(article.id) }, raw: { id: article.id, full_url_slug: article.full_url_slug, type: article.type, is_auth_required: article.is_auth_required, cost: m.cost },
        listing_evidence: evidence('CATALOGUE', EYE_API, { article_id: article.id, offset: state.offset, total_count: p.total_count, response_sha256: doc.sha256 }, 'Eye site-authored anonymous AudiencePlayer ArticleList query; all declared offsets, no sign-in or token.') }));
    }
    state.pages++; state.total = p.total_count; state.offset += list.items.length;
    await checkpoint(http, state, items);
    if (state.offset >= p.total_count) break;
    if (!list.items.length) throw new Error('EYE_EMPTY_PAGE_BEFORE_END');
  }
  const filmIds = new Set(distinct(items).map(item => item.external_id));
  if (state.ids.length !== state.total || state.film_ids.length !== filmIds.size || state.film_ids.some(id => !filmIds.has(id))) throw new Error('EYE_RESUME_CANDIDATES_MISSING');
  return result(items, 'ENUMERATED', { pages: state.pages, advertised_total: state.total, fetched_items: state.offset,
    access_method: 'Eye public AudiencePlayer GraphQL ArticleList from its current public application; film articles only, every offset.' });
}

async function sfi(source, http, items) {
  // Confirm the current service from its institution; never substitute retired Filmarkivet links.
  const institution = await http.request(source.official_url);
  const $institution = load(institution.body);
  const current = $institution('a[href]').map((i,e) => absolute($institution(e).attr('href'), source.official_url)).get().find(url => url === 'https://www.cinemateketplay.se/');
  if (!current) return result(items, 'SOURCE_CURRENT_SERVICE_UNCONFIRMED', { blocker: 'Swedish Film Institute does not currently link the audited Cinemateket Play service.' });
  const landing = await http.request(current);
  const doc = await http.request('https://play.cinemateketplay.se/'); const $ = load(doc.body);
  $('a[href]').each((i, e) => {
    const url = absolute($(e).attr('href'), doc.url);
    if (!url || !/^https:\/\/play\.cinemateketplay\.se\/watch\/[^/?]+$/.test(url)) return;
    const label = clean($(e).text()).replace(/(\d{4})$/, '').trim();
    if (label) items.push(candidate(source, { title: label, source_url: url, external_id: new URL(url).pathname.split('/').at(-1),
      listing_evidence: evidence('CATALOGUE', doc.url, { source_url: url, response_sha256: doc.sha256, institutional_link: current }, 'Visible current-service catalogue link; neither free status nor full length assumed.') }));
  });
  // Inspect only public availability flags. Never extract/reuse MAGINE auth/session tokens.
  const geo = doc.body.match(/"geoipCountry"\s*:\s*"([A-Z]{2})"/)?.[1] || null;
  const open = /"isOpenServiceActive"\s*:\s*true/.test(doc.body);
  const blocker = !open ? `Current service reports isOpenServiceActive=false for provider-observed country ${geo || 'unknown'}; catalogue access is territory/account controlled. No session token, geo override or authenticated API used.` : 'Current service exposes only curated cards; no audited anonymous full-catalogue pagination contract. MAGINE session/auth tokens are not reused.';
  await checkpoint(http, { landing_checked: true, visible_candidates: distinct(items).length }, items);
  return result(items, !open ? 'SOURCE_GEO_RESTRICTED' : 'SOURCE_PUBLIC_CATALOGUE_CONTRACT_REQUIRED', {
    blocker, access_required: 'Provider-authorized catalogue access in the supported territory, or a public metadata feed. Do not change IP/geo headers or reuse account/session tokens.',
    provider_country: geo, current_service: current, landing_sha256: landing.sha256,
    access_method: 'Institution-linked current Cinemateket Play landing and public SSR cards; partial discovery only.' });
}

async function rightsChannels(source, http, items) {
  const ownerUrl = source.id === 'angel_digital' ? 'https://www.angeldigital.co.in/' : 'https://www.shemarooent.com/youtube';
  const doc = await http.request(ownerUrl); const $ = load(doc.body);
  const channels = [...new Set($('a[href]').map((i,e) => absolute($(e).attr('href'), ownerUrl)).get().filter(url => /^https:\/\/www\.youtube\.com\/(?:channel\/UC[\w-]+|@[^/?]+|user\/[^/?]+|c\/[^/?]+)\/?$/.test(url || '')))];
  const ownership = evidence('OFFICIAL_CHANNEL_DIRECTORY', ownerUrl, { channels, response_sha256: doc.sha256 }, 'Channels explicitly linked by the rights-holder; catalogue licensing inventory is not a free-film catalogue.');
  if (!channels.length) return result(items, 'SOURCE_OFFICIAL_CHANNEL_UNRESOLVED', { blocker: 'No official YouTube channel linked by the rights-holder on the audited public page.', ownership_evidence: ownership });
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return result(items, 'SOURCE_API_CREDENTIAL_REQUIRED', { blocker: `Official ownership directory identifies ${channels.length} channel URL(s), but exhaustive uploads enumeration requires YouTube Data API v3 YOUTUBE_API_KEY. RSS/search HTML is not an exhaustive catalogue; licensing inventories and Klikk/ShemarooMe subscriptions are not free-film evidence.`,
    access_required: 'Set YOUTUBE_API_KEY securely with YouTube Data API v3 enabled and available quota. Each discovered upload still needs full-film and anonymous live playback proof.', ownership_evidence: ownership });
  const state = http.enumerationState || { channel_index: 0, channel_ids: [], page_token: '', pages: 0, seen_tokens: [] };
  const api = async (resource, params) => {
    const { data } = await http.json(`https://www.googleapis.com/youtube/v3/${resource}?${new URLSearchParams({ ...params, key })}`);
    if (data.error) throw new Error(`YOUTUBE_API_ERROR:${data.error.code}`); return data;
  };
  for (; state.channel_index < channels.length; state.channel_index++) {
    const channelUrl = new URL(channels[state.channel_index]), parts = channelUrl.pathname.split('/').filter(Boolean);
    const selection = parts[0] === 'channel' ? { id: parts[1] } : parts[0] === 'user' ? { forUsername: parts[1] } : { forHandle: parts[0].startsWith('@') ? parts[0] : parts[1] };
    const data = await api('channels', { part: 'id,snippet,contentDetails', ...selection });
    const owner = data.items?.length === 1 ? data.items[0] : null;
    if (!owner?.contentDetails?.relatedPlaylists?.uploads) throw new Error(`YOUTUBE_LINKED_CHANNEL_UNRESOLVED:${channelUrl.pathname}`);
    if (parts[0] === 'c' && owner.snippet?.customUrl?.replace(/^@/, '').toLowerCase() !== parts[1].toLowerCase()) throw new Error('ANGEL_LEGACY_CUSTOM_CHANNEL_ID_REQUIRES_CONFIRMATION');
    if (state.channel_ids.includes(owner.id) && !state.page_token) continue;
    if (!state.channel_ids.includes(owner.id)) state.channel_ids.push(owner.id);
    do {
      const batch = await api('playlistItems', { part: 'contentDetails', playlistId: owner.contentDetails.relatedPlaylists.uploads, maxResults: '50', ...(state.page_token ? { pageToken: state.page_token } : {}) });
      if (!Array.isArray(batch.items)) throw new Error('YOUTUBE_UPLOADS_RESPONSE_INVALID');
      const ids = batch.items.map(v => v.contentDetails?.videoId).filter(Boolean);
      if (ids.length) {
        const videos = await api('videos', { part: 'snippet,contentDetails,status', id: ids.join(',') });
        for (const video of videos.items || []) {
          if (video.snippet?.channelId !== owner.id) throw new Error('YOUTUBE_UPLOAD_CHANNEL_MISMATCH');
          items.push(candidate(source, { title: video.snippet.title, source_url: `https://www.youtube.com/watch?v=${video.id}`, external_id: video.id,
            external_identifiers: { youtube_video: video.id }, raw: { video, channel_id: owner.id, ownership_evidence: ownership }, listing_evidence: ownership }));
        }
      }
      const next = batch.nextPageToken || '';
      if (next && state.seen_tokens.includes(`${owner.id}:${next}`)) throw new Error('YOUTUBE_REPEATED_PAGE_TOKEN');
      if (next) state.seen_tokens.push(`${owner.id}:${next}`);
      state.page_token = next; state.pages++;
      // A completed channel must not be skipped halfway or replayed after interruption.
      await checkpoint(http, next ? state : { ...state, channel_index: state.channel_index + 1 }, items);
    } while (state.page_token);
  }
  await checkpoint(http, state, items);
  return result(items, 'ENUMERATED', { pages: state.pages, official_channel_ids: state.channel_ids, ownership_evidence: ownership,
    access_method: 'Rights-holder-linked channels; YouTube Data API uploads playlists through every nextPageToken. Upload visibility alone is not free/full/live proof.' });
}

const add = (record, kind, url, value, method) => record.verification_evidence.push(evidence(kind, url, value, method, record.last_checked_at));
const reject = (record, code) => { record.lifecycle_status = 'REJECTED'; throw new Error(code); };
async function bfiVerify(source, item, http, record) {
  bfiFilmUrl(item.source_url); // Reject unsafe input before dispatch, not just after redirects.
  const nid = item.external_identifiers?.bfi_nid;
  if (nid != null) {
    if (typeof nid !== 'string' || !/^[1-9]\d*$/.test(nid)) throw new Error('BFI_NATIVE_ID_INVALID');
    const { doc, hits, total } = await bfiSearch(http, { size: 2, track_total_hits: true, query: bfiQuery([{ term: { nid } }]) });
    if (total !== 1 || hits.length !== 1 || hits[0]._source?.nid !== nid) throw new Error('BFI_SEARCH_IDENTITY_MISMATCH');
    const metadata = bfiMetadata(hits[0]._source);
    if (metadata.source_url !== item.source_url) throw new Error('BFI_SEARCH_URL_IDENTITY_MISMATCH');
    Object.assign(record.metadata, metadata);
    record.runtime = metadata.runtime;
    add(record, 'AUTHORITATIVE_METADATA', BFI_SEARCH, { nid, uuid: metadata.bfi_uuid, sha256: doc.sha256, pillar: 'free' }, 'Fresh official BFI search record matched by exact keyword nid and canonical free-film URL; absent directors remain absent.');
  }
  const doc = await http.request(item.source_url); const $ = load(doc.body);
  record.http_status = doc.status;
  if (doc.url !== item.source_url) add(record, 'DETAIL_REDIRECT', item.source_url, { final_url: safeMediaUrl(doc.url), status: doc.status, sha256: doc.sha256 }, 'Observed final detail URL; identity/free/full/live contract is validated separately, never expanded by a redirect.');
  bfiFilmUrl(doc.url);
  const title = clean($('h1').first().text()); if (!title) throw new Error('BFI_TITLE_MISSING');
  if (nid && ![record.metadata.title, record.metadata.original_title].some(t => normalizeTitle(t) === normalizeTitle(title))) throw new Error('BFI_DETAIL_TITLE_MISMATCH');
  const facts = $('.film-metadata-summary');
  const value = label => clean(facts.find(`[aria-label="${label}"]`).text());
  // Legacy saved candidates can still be checked conservatively, but no native
  // identity is invented from their URL or HTML. New observations use search.
  if (!nid) {
    record.metadata.title = record.metadata.display_title = record.metadata.original_title = title;
    record.metadata.year = Number(value('Release Date').match(/\d{4}/)?.[0]) || null;
    record.metadata.director_credit = clean(facts.find('p').map((i,e) => clean($(e).text())).get().find(t => /^Directed by\s+/i.test(t))).replace(/^Directed by\s*/i, '') || null;
    record.metadata.countries = value('Country of Origin') ? [value('Country of Origin')] : [];
    record.runtime = Number(value('Duration').match(/[\d.]+/)?.[0]) || null;
  }
  record.audio_languages = value('Language') ? [value('Language')] : [];
  record.official_or_rights_verified = true;
  add(record, 'DETAIL', item.source_url, { title, status: doc.status, sha256: doc.sha256 }, 'Title-specific official BFI page and metadata.');
  const genre = value('Genre');
  if (clipTitle(title) || /\b(?:Q&A|extended qa|screen talk|in conversation|you must see)\b/i.test(title) || /interview|inside film/i.test(genre)) reject(record, 'BFI_SUPPLEMENTARY_NOT_FULL_FILM');
  if (/\b(?:fragment|excerpt|extract|incomplete)\b/i.test(clean($('.film-synopsis').text()))) reject(record, 'BFI_INCOMPLETE_FILM');
  const player = $('video[data-pillar="free"][data-video-type="film"]').first();
  const freeButton = $('a#play-film[data-video-id]').filter((i,e) => /watch for free/i.test(clean($(e).text()))).first();
  add(record, 'CLASSIFICATION', item.source_url, { genre, runtime: record.runtime, free_button: Boolean(freeButton.length), full_player_offered: Boolean(player.length) }, 'Free pillar and Watch for free CTA are classification evidence only, not independent live playback.');
  if (!player.length || !freeButton.length) throw new Error('BFI_FREE_FULL_PLAYER_NOT_OFFERED');
  const videoId = player.attr('data-ref-id'), account = player.attr('data-acid');
  if (videoId !== freeButton.attr('data-video-id') || account !== freeButton.attr('data-ac')) throw new Error('BFI_FULL_PLAYER_IDENTITY_MISMATCH');
  // Brightcove entitlement/geo/DRM contract has not been audited. Do not fetch guessed media or use policy/session keys.
  add(record, 'PLAYER_REVIEW', item.source_url, { provider: 'Brightcove', video_id: videoId, account_id: account, pillar: 'free', media_requested: false }, 'Official full player identified, but no supported independent Brightcove live gate; remain nonwatchable.');
  throw new Error('BFI_BRIGHTCOVE_ANONYMOUS_PLAYBACK_CONTRACT_REQUIRED');
}
async function eyeVerify(source, item, http, record) {
  if (!/^\d+$/.test(item.external_id)) throw new Error('EYE_ARTICLE_ID_INVALID');
  const { doc, data } = await eyeQuery(http, `query { Article(id: ${item.external_id}) { ${eyeFields} products { id price } } }`);
  const article = data?.Article;
  if (!article || String(article.id) !== item.external_id || article.full_url_slug !== item.raw?.full_url_slug) throw new Error('EYE_ARTICLE_IDENTITY_MISMATCH');
  const m = eyeMetadata(article);
  Object.assign(record.metadata, { title: m.title, display_title: m.title, original_title: m.title, year: m.year, director_credit: m.director_credit, countries: m.countries });
  record.runtime = m.runtime; record.audio_languages = m.audio_languages; record.subtitle_languages = m.subtitle_languages;
  record.official_or_rights_verified = true;
  add(record, 'DETAIL', EYE_API, { article_id: article.id, full_url_slug: article.full_url_slug, sha256: doc.sha256, cost: m.cost, assets: m.full_assets, is_auth_required: article.is_auth_required }, 'Fresh title-specific official Eye application API metadata; trailer assets excluded from film identity.');
  if (article.type !== 'film' || m.incomplete || clipTitle(m.title)) reject(record, 'EYE_NOT_COMPLETE_FILM');
  if (/^(?:betaald|paid|huur|rental)$/i.test(m.cost || '') || article.products?.some(p => Number(p.price) > 0)) reject(record, 'EYE_PAID_RENTAL');
  if (!/^(?:gratis|free)$/i.test(m.cost || '')) throw new Error('EYE_FREE_STATUS_UNCONFIRMED');
  if (m.full_assets.length !== 1 || !m.runtime) throw new Error('EYE_FULL_ASSET_UNCONFIRMED');
  if (article.is_auth_required || m.full_assets[0].accessibility !== 'everyone') throw new Error('EYE_FREE_FILM_REQUIRES_AUTHORIZED_ACCOUNT');
  throw new Error('EYE_ANONYMOUS_FULL_PLAYBACK_CONTRACT_REQUIRED');
}
async function sfiVerify(source, item, http, record) {
  const doc = await http.request(item.source_url);
  if (new URL(doc.url).origin !== 'https://play.cinemateketplay.se') throw new Error('CINEMATEKET_DETAIL_REDIRECT_OUTSIDE_PROVIDER');
  record.official_or_rights_verified = true;
  add(record, 'DETAIL', item.source_url, { sha256: doc.sha256, status: doc.status }, 'Current Cinemateket Play title page; no retired Filmarkivet link or token reuse.');
  if (/"isOpenServiceActive"\s*:\s*false/.test(doc.body)) throw new Error('CINEMATEKET_PROVIDER_GEO_OR_ACCOUNT_RESTRICTED');
  throw new Error('CINEMATEKET_FREE_FULL_ANONYMOUS_PLAYBACK_CONTRACT_REQUIRED');
}
async function channelVerify(source, item, http, record) {
  const video = item.raw?.video;
  if (!video || video.id !== item.external_id || video.snippet?.channelId !== item.raw.channel_id || !item.raw.ownership_evidence) throw new Error('RIGHTSHOLDER_UPLOAD_IDENTITY_UNCONFIRMED');
  record.official_or_rights_verified = true;
  add(record, 'OFFICIAL', item.raw.ownership_evidence.url, item.raw.ownership_evidence.value, 'Rights-holder-linked official channel matches the enumerated video uploader.');
  if (/\b(?:clip|scene|song|trailer|teaser|part\s*\d+)\b/i.test(item.title)) reject(record, 'RIGHTSHOLDER_NOT_FULL_FILM');
  // API public status, channel ownership or a title saying Full Movie cannot prove free anonymous playback.
  throw new Error('YOUTUBE_FULL_FILM_AND_ANONYMOUS_LIVE_PLAYBACK_REVIEW_REQUIRED');
}

export const additionalEnumerators = { bfi_player_free: bfi, eye_film_player: eye, cinemateket_play_sweden: sfi, angel_digital: rightsChannels, shemaroo: rightsChannels };
export const additionalVerifiers = { bfi_player_free: bfiVerify, eye_film_player: eyeVerify, cinemateket_play_sweden: sfiVerify, angel_digital: channelVerify, shemaroo: channelVerify };
