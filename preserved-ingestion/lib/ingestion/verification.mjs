import { load } from 'cheerio';
import { absolute, assignmentJson, checkHls, clean, clipTitle, digest, evidence, normalizeTitle, safeMediaUrl } from './http.mjs';
import { additionalVerifiers } from './providers/bfi-eye-sfi-channels.mjs';
import { verifiers as nfajNzVerifiers } from './providers/nfaj-nz.mjs';

const hosts = {
  loc_national_screening_room: ['www.loc.gov', 'loc.gov'], nfb_canada: ['www.nfb.ca', 'www.onf.ca'],
  mosfilm: ['www.mosfilm.ru'], dfi_danish_silent: ['www.stumfilm.dk'], cinematheque_henri: ['www.cinematheque.fr'],
  retina_latina: ['www.retinalatina.org'], filmoteca_unam: ['cineenlinea.filmoteca.unam.mx'], '35mm_online': ['35mm.online'],
  kofa_korean_classic_film: ['www.youtube.com'], saina_movies: ['www.youtube.com'], ap_international: ['www.youtube.com'],
  bfi_player_free: ['player.bfi.org.uk'], eye_film_player: ['player.eyefilm.nl'],
  cinemateket_play_sweden: ['play.cinemateketplay.se'], nfaj_japanese_animation_classics: ['animation.filmarchives.jp'],
  nz_on_screen: ['www.nzonscreen.com'], angel_digital: ['www.youtube.com'], shemaroo: ['www.youtube.com'],
};
const list = (value) => Array.isArray(value) ? value.map((item) => typeof item === 'string' ? item : item.name || item.label || item.language).filter(Boolean) : [];
const seconds = (text) => String(text || '').split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
const matches = (a, b) => normalizeTitle(a) && normalizeTitle(a) === normalizeTitle(b);
const trusted = (source, url) => { try { const u = new URL(url); return u.protocol === 'https:' && hosts[source.id]?.includes(u.hostname); } catch { return false; } };
const titleOf = ($) => clean($('h1').first().text());
const add = (record, kind, url, value, method) => record.verification_evidence.push(evidence(kind, safeMediaUrl(url), value, method, record.last_checked_at));
const paid = (item) => item?.isSubscription === true || item?.isPremium === true || (item?.prices?.price && !/^0(?:[,.]0+)?(?:\s|$)/u.test(item.prices.price));

function base(source, candidate) {
  return {
    // Retain the previous session's source-id hash to update rather than duplicate its sources.
    source_id: `source_${source.id}_${digest(candidate.source_url || candidate.external_id).slice(0, 16)}`,
    registry_source_id: source.id, source_owner: source.name, canonical_source_url: candidate.source_url,
    external_watch_url: candidate.source_url, full_film_verified: false, free_verified: false, official_or_rights_verified: false,
    embed_status: /EXTERNAL_ONLY/u.test(source.embed_policy || '') ? 'PROHIBITED' : 'UNKNOWN', embed_working: false,
    embed_url_if_allowed: null, territories: [], audio_languages: [], subtitle_languages: [], version_or_restoration: null,
    runtime: Number(candidate.runtime) > 0 ? Number(candidate.runtime) : null, first_verified_at: null,
    last_checked_at: new Date().toISOString(), verification_evidence: [], availability_expiry_if_known: null,
    live_check_status: 'PENDING', lifecycle_status: 'REVIEW', watch_state: 'NO_VERIFIED_FREE_STREAM',
    adapter_id: `provider-v2:${source.id}`, rejection_reason: null, error_code: null,
    metadata: { title: candidate.title, display_title: candidate.display_title || candidate.title, original_title: candidate.original_title || candidate.title,
      alternate_titles: candidate.alternate_titles || [], countries: candidate.countries || [], year: candidate.year || null,
      director_credit: candidate.director_credit || null, runtime: candidate.runtime || null, external_id: candidate.external_id,
      external_identifiers: structuredClone(candidate.external_identifiers || {}), poster_url: candidate.poster_url || null,
      metadata_gaps: [], parser: candidate.parser },
  };
}

async function detail(source, candidate, http, record) {
  const doc = await http.request(candidate.source_url);
  record.http_status = doc.status;
  add(record, 'DETAIL', candidate.source_url, { status: doc.status, sha256: doc.sha256 }, 'Official canonical film detail fetched; HTTP success is not playback evidence.');
  if (!trusted(source, doc.url)) throw new Error('DETAIL_REDIRECT_OUTSIDE_OFFICIAL_PROVIDER');
  const $ = load(doc.body);
  const actualTitle = titleOf($);
  if (actualTitle && ![candidate.title, candidate.original_title, ...(candidate.alternate_titles || [])].some((title) => matches(title, actualTitle)))
    throw new Error('DETAIL_TITLE_MISMATCH');
  record.official_or_rights_verified = true;
  add(record, 'OFFICIAL', candidate.source_url, { registry_source: source.id, title: actualTitle || candidate.title }, 'Title-specific page on registered institution/rightsholder domain.');
  return { doc, $ };
}

async function vimeo(playerUrl, http, record) {
  const player = new URL(playerUrl);
  if (player.hostname !== 'player.vimeo.com' || !/^\/video\/\d+$/u.test(player.pathname)) throw new Error('UNSUPPORTED_VIMEO_URL');
  const id = player.pathname.split('/').at(-1);
  const configUrl = new URL(`${player.origin}${player.pathname}/config`);
  // Preserve only an access parameter explicitly supplied by the institution's official player.
  if (player.searchParams.has('h')) configUrl.searchParams.set('h', player.searchParams.get('h'));
  const { data: config } = await http.json(configUrl.href);
  if (String(config.video?.id) !== id || !(Number(config.video?.duration) > 0)) throw new Error('VIMEO_VIDEO_ID_OR_DURATION_MISSING');
  const expected = record.runtime;
  const duration = Number(config.video.duration) / 60;
  if (!expected || Math.abs(expected - duration) > Math.max(2, expected * 0.12)) throw new Error('VIMEO_DURATION_CONFLICT_OR_UNKNOWN');
  record.audio_languages = list(config.video.lang ? [config.video.lang] : record.audio_languages);
  record.subtitle_languages = list(config.request?.text_tracks?.map((track) => track.lang));
  add(record, 'FULL_FILM', playerUrl, { video_id: id, duration_minutes: duration, catalogue_minutes: expected }, 'Official page linked Vimeo video identity and duration match catalogue runtime.');
  const cdns = config.request?.files?.hls?.cdns || {};
  const stream = cdns[config.request?.files?.hls?.default_cdn]?.url || Object.values(cdns).map((cdn) => cdn.url).find((url) => url?.startsWith('https://'));
  if (!stream) throw new Error('VIMEO_NO_PUBLIC_HLS');
  const check = await checkHls(http, stream, expected);
  if (check.evidence) record.verification_evidence.push(check.evidence);
  if (!check.verified) throw new Error(check.reason || 'VIMEO_MEDIA_UNCONFIRMED');
  record.runtime = duration; record.full_film_verified = true; record.free_verified = true; record.live_check_status = 'PASS';
  add(record, 'FREE', record.canonical_source_url, { authenticated: false, paid: false }, 'Official public player served complete playable media without sign-in or payment.');
  // Vimeo allowing playback inside an institution's page is NOT permission to embed on our site.
}

async function nfb(source, candidate, http, record) {
  if (candidate.raw?.category !== 'film' || candidate.raw?.availability?.is_public !== true) throw new Error('NFB_NOT_PUBLIC_FILM');
  record.full_film_verified = Boolean(record.runtime && !clipTitle(candidate.title));
  if (http.nfbMediaBlocker) {
    record.official_or_rights_verified = true;
    record.metadata.metadata_gaps.push('canonical_detail_live_check');
    add(record, 'PROVIDER_ACCESS_BLOCKER', candidate.source_url, { host: http.nfbMediaBlocker.host, original_error: http.nfbMediaBlocker.code, title_playback_attempted: false }, 'Earlier official NFB player media access was denied for this provider host; remaining titles stay in review without repeatedly requesting a denied host.');
    throw new Error('NFB_PROVIDER_MEDIA_ACCESS_BLOCKED');
  }
  const { doc, $ } = await detail(source, candidate, http, record);
  add(record, 'FULL_FILM', candidate.source_url, { category: candidate.raw.category, duration_seconds: candidate.raw.duration, version_id: candidate.version_id }, 'NFB film-category and source runtime, excluding clip/trailer titles.');
  const embeds = $('iframe[src]').map((i, node) => $(node).attr('src')).get();
  const embedUrl = embeds.find((url) => /https:\/\/(?:www\.nfb\.ca|www\.onf\.ca)\/film\/[^/]+\/embed\/player\//u.test(url));
  if (!embedUrl) throw new Error('NFB_OFFICIAL_PLAYER_UNAVAILABLE');
  const player = await http.request(embedUrl);
  const options = assignmentJson(player.body, 'window.IFRAME_OPTIONS');
  if (!options || options.gtm?.versionType !== 'film' || !matches(options.overlay?.title, candidate.title)) throw new Error('NFB_PLAYER_IDENTITY_MISMATCH');
  record.audio_languages = options.gtm?.versionLang ? [options.gtm.versionLang] : [];
  record.subtitle_languages = list(options.textTracks?.map((track) => track.lang));
  if (!options.source?.startsWith('https://')) throw new Error('NFB_NO_PUBLIC_MEDIA');
  let check;
  try { check = await checkHls(http, options.source, record.runtime); }
  catch (error) {
    if (error.code === 'SOURCE_ACCESS_BLOCKED') http.nfbMediaBlocker = { host: new URL(error.url || options.source).hostname, code: error.code };
    throw error;
  }
  if (check.evidence) record.verification_evidence.push(check.evidence);
  record.free_verified = check.verified; record.live_check_status = check.verified ? 'PASS' : 'PENDING';
  if (!check.verified) throw new Error(check.reason);
  add(record, 'FREE', doc.url, { public_player: true, sign_in: false, payment: false }, 'Complete film media available through official public player without payment.');
  // Noncommercial use + linkback terms have not been approved for this project's use. External only for now.
  record.embed_status = 'UNKNOWN';
  add(record, 'EMBED', embedUrl, { official_embed_offered: true, project_noncommercial_terms_audit: 'PENDING' }, 'Do not equate an offered embed with satisfaction of the current NFB terms.');
}

async function henri(source, candidate, http, record) {
  const { $, doc } = await detail(source, candidate, http, record);
  if (/Film indisponible/iu.test($('body').text())) { record.live_check_status = 'FAIL'; record.lifecycle_status = 'EXPIRED'; throw new Error('HENRI_FILM_UNAVAILABLE'); }
  const director = clean($('.realisateurs').first().text());
  if (director) record.metadata.director_credit = director;
  const info = $('div').map((i, node) => $(node).children().length ? '' : clean($(node).text())).get().find((text) => /\/\s*(?:c\.\s*)?\d{4}\s*\/\s*\d+:\d+/u.test(text));
  if (info) {
    const fields = info.split('/').map((value) => value.trim());
    record.metadata.countries = [fields[0]]; record.metadata.year = Number(fields[1].replace(/\D/gu, '')) || record.metadata.year;
    record.runtime = seconds(fields[2]) / 60 || record.runtime;
  }
  const restoration = clean($('[class*="restaur"]').text());
  if (restoration) record.version_or_restoration = restoration;
  const player = $('iframe[src]').map((i, node) => $(node).attr('src')).get().find((url) => url.startsWith('https://player.vimeo.com/video/'));
  if (!player) throw new Error('HENRI_PUBLIC_PLAYER_UNAVAILABLE');
  await vimeo(player, http, record);
  record.embed_status = 'PROHIBITED';
  add(record, 'EMBED', doc.url, { policy: source.embed_policy }, 'Registry requires viewing on the Cinémathèque service, never internal playback.');
}

async function dfi(source, candidate, http, record) {
  const { $, doc } = await detail(source, candidate, http, record);
  const hero = clean($('.header__hero__text').text()).match(/^(.+?),\s*(\d{4}),\s*([0-9.]+)\s*min/iu);
  if (hero) { record.metadata.director_credit = hero[1]; record.metadata.year = Number(hero[2]); record.runtime = Number(hero[3]); }
  $('.credits__title').each((i, node) => {
    const label = clean($(node).text()).toLowerCase(); const value = clean($(node).parent().text()).slice(clean($(node).text()).length).trim();
    if (/director/u.test(label) && value) record.metadata.director_credit = value;
    if (/original title/u.test(label) && value) record.metadata.original_title = value;
    if (/production country/u.test(label) && value) record.metadata.countries = [value];
    if (/production year/u.test(label)) record.metadata.year = Number(value.match(/\d{4}/u)?.[0]) || record.metadata.year;
    if (/length|duration|running time/u.test(label)) record.runtime = Number(value.match(/[0-9.]+/u)?.[0]) || record.runtime;
  });
  let player = null;
  $('[data-video]').each((i, node) => { try { const value = JSON.parse($(node).attr('data-video')); if (value.embed?.startsWith('https://player.vimeo.com/video/')) player = value.embed; } catch {} });
  if (!player) throw new Error('DFI_PUBLIC_PLAYER_UNAVAILABLE');
  await vimeo(player, http, record);
  add(record, 'EMBED', doc.url, { policy: 'NEEDS_CURRENT_TERMS_AUDIT' }, 'Official Vimeo integration does not establish third-party embedding permission.');
}

function spanishExpiry(text) {
  const match = text.match(/hasta el\s+(\d{1,2})\s+de\s+(\p{L}+)\s+de\s+(\d{4})/iu);
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  if (!match || !months.includes(match[2].toLowerCase())) return null;
  // Conservatively expire at the beginning of the advertised final day (provider timezone is unknown).
  return new Date(Date.UTC(Number(match[3]), months.indexOf(match[2].toLowerCase()), Number(match[1]))).toISOString();
}

async function retina(source, candidate, http, record) {
  const { $, doc } = await detail(source, candidate, http, record);
  $('script,style,nav,footer').remove(); const text = clean($('body').text());
  const direction = text.match(/Dirección:\s*([^|]+)\|/iu)?.[1];
  if (direction) record.metadata.director_credit = direction.trim();
  const info = text.match(/\|\s*(\d{4})\s*\|\s*([0-9.]+)\s*min/iu);
  if (info) { record.metadata.year = Number(info[1]); record.runtime = Number(info[2]); }
  const territory = text.match(/Disponible para\s*-\s*(.+?)\s*-\s*hasta el/iu)?.[1];
  record.territories = territory ? [territory.trim()] : [];
  record.availability_expiry_if_known = spanishExpiry(text);
  record.audio_languages = text.match(/Idioma:\s*([^|]+)/iu)?.[1]?.trim() ? [text.match(/Idioma:\s*([^|]+)/iu)[1].trim()] : [];
  record.full_film_verified = /\b(?:Cortometraje|Largometraje)\b/iu.test(text) && /Ver película/iu.test(text) && record.runtime > 0;
  add(record, 'AVAILABILITY', doc.url, { territories: record.territories, expiry: record.availability_expiry_if_known, runtime: record.runtime, full_film_listing: record.full_film_verified }, 'Retina Latina title page film type, availability territory and expiry; player must still be independently confirmed.');
  if (record.availability_expiry_if_known && new Date(record.availability_expiry_if_known) <= new Date()) { record.live_check_status = 'FAIL'; record.lifecycle_status = 'EXPIRED'; throw new Error('RETINA_AVAILABILITY_EXPIRED'); }
  const vimeoUrl = $('iframe[src]').map((i, node) => $(node).attr('src')).get().find((url) => url.startsWith('https://player.vimeo.com/video/'));
  if (vimeoUrl) return vimeo(vimeoUrl, http, record);
  // InstantVideoCloud requires its own documented current player API; a player iframe alone is not a live-film test.
  throw new Error('RETINA_INSTANTVIDEOCLOUD_PLAYBACK_CONTRACT_REQUIRED');
}

async function mosfilm(source, candidate, http, record) {
  const { $, doc } = await detail(source, candidate, http, record);
  const facts = {};
  $('.lead-movie__item-title').each((i, node) => { const e = $(node); facts[clean(e.text()).replace(/:$/u, '')] = clean(e.parent().text()).slice(clean(e.text()).length).trim(); });
  record.metadata.year = Number(facts['Дата выхода']?.match(/\d{4}/u)?.[0]) || record.metadata.year;
  record.metadata.director_credit = facts['Режиссёры'] || record.metadata.director_credit;
  record.runtime = Number(facts['Длительность']?.match(/[0-9.]+/u)?.[0]) || record.runtime;
  record.version_or_restoration = facts['Год реставрации'] ? `Restoration ${facts['Год реставрации']}` : null;
  const players = $('[data-tab-src]').map((i, node) => $(node).attr('data-tab-src')).get();
  add(record, 'OFFICIAL_PLAYER_LINKS', doc.url, { players: players.map(safeMediaUrl), runtime: record.runtime, year: record.metadata.year, director: record.metadata.director_credit }, 'Mosfilm-controlled title page explicitly supplies these platform players; no rights inferred from random uploads.');
  const youtube = players.find((url) => /^https:\/\/www\.youtube\.com\/embed\/[^/?]+/u.test(url));
  if (youtube) return youtubeVideo(source, candidate, http, record, youtube.split('/').at(-1).split('?')[0], true);
  throw new Error('MOSFILM_PLATFORM_PLAYBACK_API_REQUIRED');
}

async function unam(source, candidate, http, record) {
  await detail(source, candidate, http, record);
  const video = candidate.raw?.video_url;
  if (!video) throw new Error('UNAM_SOURCE_VIDEO_MISSING');
  const url = new URL(video);
  if (url.hostname === 'youtu.be' || ['www.youtube.com', 'youtube.com'].includes(url.hostname)) {
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.split('/').at(-1);
    return youtubeVideo(source, candidate, http, record, id, true);
  }
  if (url.hostname === 'player.vimeo.com') return vimeo(url.href, http, record);
  throw new Error('UNAM_PLAYER_PROVIDER_REVIEW_REQUIRED');
}

async function thirtyFive(source, candidate, http, record) {
  if (paid(candidate.raw)) {
    record.official_or_rights_verified = true; record.lifecycle_status = 'REJECTED';
    add(record, 'PAID_ONLY', candidate.source_url, { prices: candidate.raw.prices, subscription: candidate.raw.isSubscription, premium: candidate.raw.isPremium }, 'Official 35mm.online content API marks this item as paid/subscription; registry free default is not item evidence.');
    throw new Error('35MM_PAID_OR_SUBSCRIPTION');
  }
  const { data } = await http.json('https://cms.35mm.online/umbraco/api/content', { headers: { 'x-origin-url': candidate.source_url } });
  if (data.statusCode !== 200 || data.content?.alias === 'errorPage') throw new Error('35MM_TITLE_CONTENT_UNAVAILABLE');
  add(record, 'DETAIL', candidate.source_url, { status: data.statusCode, alias: data.content?.alias }, 'Official CMS title-specific response; anonymous full-player access still required.');
  throw new Error('35MM_FREE_FULL_PLAYER_CONTRACT_REQUIRED');
}

async function youtubeVideo(source, candidate, http, record, videoId, officialLinked = false) {
  if (!/^[a-zA-Z0-9_-]{11}$/u.test(videoId || '')) throw new Error('YOUTUBE_INVALID_VIDEO_ID');
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_CREDENTIAL_REQUIRED');
  const { data } = await http.json('https://www.googleapis.com/youtube/v3/videos?' + new URLSearchParams({ key: apiKey, part: 'snippet,contentDetails,status', id: videoId }));
  const video = data.items?.find((item) => item.id === videoId);
  if (!video || video.status?.privacyStatus !== 'public' || video.status?.uploadStatus !== 'processed') throw new Error('YOUTUBE_VIDEO_NOT_PUBLIC');
  record.audio_languages = video.snippet?.defaultAudioLanguage ? [video.snippet.defaultAudioLanguage] : [];
  record.territories = video.contentDetails?.regionRestriction?.allowed || (video.contentDetails?.regionRestriction?.blocked || []).map((code) => `BLOCKED:${code}`);
  record.metadata.external_identifiers.youtube_video = videoId;
  add(record, 'PLATFORM_METADATA', candidate.source_url, { video_id: videoId, duration: video.contentDetails?.duration, embed_enabled: video.status.embeddable, privacy: video.status.privacyStatus, region_restriction: video.contentDetails?.regionRestriction || null }, 'YouTube Data API status and territory metadata; does NOT establish full-film/free/live playback by itself.');
  record.official_or_rights_verified = officialLinked;
  throw new Error(officialLinked ? 'YOUTUBE_ANONYMOUS_FULL_PLAYBACK_CHECK_REQUIRED' : 'YOUTUBE_CHANNEL_OWNERSHIP_AND_FULL_PLAYBACK_REVIEW_REQUIRED');
}

const channelVideo = (source, candidate, http, record) => youtubeVideo(source, candidate, http, record, candidate.external_id, false);
const verifiers = { nfb_canada: nfb, cinematheque_henri: henri, dfi_danish_silent: dfi, retina_latina: retina,
  mosfilm, filmoteca_unam: unam, '35mm_online': thirtyFive,
  kofa_korean_classic_film: channelVideo, saina_movies: channelVideo, ap_international: channelVideo,
  ...additionalVerifiers, ...nfajNzVerifiers };

export async function verifyCandidate(source, candidate, http) {
  const record = base(source, candidate);
  try {
    if (candidate.listing_evidence) record.verification_evidence.push(candidate.listing_evidence);
    if (candidate.unavailable) { record.lifecycle_status = 'EXPIRED'; record.live_check_status = 'FAIL'; throw new Error('SOURCE_CATALOGUE_MARKED_UNAVAILABLE'); }
    if (candidate.incomplete || clipTitle(candidate.title)) { record.lifecycle_status = 'REJECTED'; throw new Error('NOT_COMPLETE_FILM'); }
    if (!trusted(source, candidate.source_url)) throw new Error('SOURCE_HOST_NOT_IN_AUDITED_CONTRACT');
    const verifier = verifiers[source.id];
    if (!verifier) throw new Error('PROVIDER_VERIFIER_UNAVAILABLE');
    await verifier(source, candidate, http, record);
  } catch (error) {
    record.error_code = error.code || error.message;
    record.rejection_reason = record.error_code;
    record.http_status ??= error.status || null;
    if ([404,410].includes(error.status)) { record.live_check_status = 'FAIL'; record.lifecycle_status = 'EXPIRED'; }
    add(record, 'CHECK_ERROR', error.url || candidate.source_url, { code: record.error_code, http_status: error.status || null }, 'Failed closed: no protection, TLS, payment, geo or authentication bypass attempted.');
  }
  record.metadata.runtime = record.runtime;
  record.metadata.metadata_gaps.push(...['director_credit','year','runtime'].filter((field) => !record.metadata[field]));
  for (const [name,value] of [['audio_languages',record.audio_languages],['subtitle_languages',record.subtitle_languages],['territories',record.territories]]) if (!value.length) record.metadata.metadata_gaps.push(name);
  if (record.full_film_verified && record.free_verified && record.official_or_rights_verified && record.live_check_status === 'PASS') {
    record.lifecycle_status = 'VERIFIED'; record.first_verified_at = record.last_checked_at;
    record.watch_state = record.embed_status === 'PERMITTED' && record.embed_working && record.embed_url_if_allowed ? 'WATCH_HERE' : 'WATCH_FREE_EXTERNALLY';
  }
  return record;
}
