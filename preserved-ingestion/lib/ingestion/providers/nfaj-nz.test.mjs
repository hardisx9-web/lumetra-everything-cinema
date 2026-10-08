import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveWatchState } from '../../../src/data/source-model.js';
import { verifyCandidate } from '../verification.mjs';
import { digest, SourceAccessError } from '../http.mjs';
import { enumerateNfaj, enumerateNzOnScreen, enumerators, verifyNfaj, verifyNzOnScreen, verifiers } from './nfaj-nz.mjs';

const NFAJ = 'nfaj_japanese_animation_classics', NZ = 'nz_on_screen';
const JAPAN = 'https://animation.filmarchives.jp', NEW_ZEALAND = 'https://www.nzonscreen.com';
const source = (id) => ({ id, name: id, embed_policy: 'EXTERNAL_ONLY' });
function mockHttp(handler, robots = 'User-agent: *\nAllow: /\nDisallow: /admin\n') {
  const calls = [];
  return { calls, async request(url, options = {}) {
    calls.push({ url, options });
    if (new URL(url).pathname === '/robots.txt') {
      if (robots === null) throw new SourceAccessError('SOURCE_UNAVAILABLE', url, 404);
      if (robots instanceof Error) throw robots;
      return { url, body: robots, status: 200, headers: {}, sha256: digest(robots) };
    }
    const response = await handler(url, options);
    const body = typeof response === 'string' ? response : response.body || '';
    return { url, body, status: 200, headers: {}, sha256: digest(body), ...(typeof response === 'object' ? response : {}) };
  } };
}
function nfajPage(ids, pages = 1, page = 1) {
  const cards = ids.map((id) => `<a href="/en/works/view/${id}"><h2 class="work-result-heading">Film ${id}</h2><p class="work-result-title-en">日本語 ${id}</p><p class="work-result-properties">Prod. Year : 1940 Dir. : A Director</p></a>`).join('');
  return `${cards}<ul class="pager-menu">${page < pages ? `<li class="next"><a rel="next" href="/en/works?num=50&amp;page=${page + 1}">Next</a></li>` : '<li class="next disabled">Next</li>'}</ul>`;
}
const filterResponse = { categories: [{ id: 'Film', display_name: 'Film' }, { id: 'Short film', display_name: 'Short film' }] };
const nzItem = (id, category = 'Film') => ({ id, title: `Film ${id}`, html_url: `${NEW_ZEALAND}/videos/film-${id}/`, page_type: 'VideoPage', media_type_category: category, duration: { raw: 600 }, production: { start_date: 1966 } });
function nzCatalogue(handler, robots) {
  return mockHttp((url, options) => new URL(url).pathname === '/api/v3/search/filters' ? JSON.stringify(filterResponse) : handler(url, options), robots);
}
const nzBatch = (results, page_number, total_count, page_size = 1) => JSON.stringify({ results, pagination: { page_number, total_count, page_size } });
const nfajCandidate = { title: 'Film 1', original_title: '日本語 1', source_url: `${JAPAN}/en/works/view/1`, external_id: '1', external_identifiers: { nfaj_work: '1' }, runtime: null };
const nzCandidate = { title: 'Film 1', source_url: `${NEW_ZEALAND}/videos/film-1/`, external_id: '1', external_identifiers: { nzonscreen_page: '1' }, runtime: 10, raw: { media_type_category: 'Film' } };
function base(candidate) {
  return { canonical_source_url: candidate.source_url, external_watch_url: candidate.source_url, verification_evidence: [], last_checked_at: new Date().toISOString(),
    metadata: { title: candidate.title, original_title: candidate.original_title || candidate.title, alternate_titles: [], external_identifiers: { ...candidate.external_identifiers }, metadata_gaps: [] },
    runtime: candidate.runtime, lifecycle_status: 'REVIEW', full_film_verified: false, free_verified: false, official_or_rights_verified: false, live_check_status: 'PENDING',
    watch_state: 'NO_VERIFIED_FREE_STREAM', embed_status: 'UNKNOWN', embed_working: false, embed_url_if_allowed: null,
  };
}
const nfajFacts = (completeness = 'complete') => `<h1>Film 1</h1><table class="work-details"><tr><th>Original Title</th><td>日本語 1</td></tr><tr><th>Japanese kana Rendering</th><td>Romaji 1</td></tr><tr><th>Production Date</th><td>1940</td></tr><tr><th>Author</th><td>A Director</td></tr><tr><th>Duration (minutes)</th><td>10</td></tr><tr><th>Completeness</th><td>${completeness}</td></tr></table><a href="/en/works/playen/1">Watch</a>`;
const nfajFaq = 'The videos cannot be embedded in other websites. Please use links to the website, which allows access to the videos free of charge. Copying and saving is prohibited.';
function nfajDetailHttp({ completeness = 'complete', player = '<h1>Film 1</h1><iframe src="//h10.cs.nii.ac.jp/view/video_view.php?fileName=1_en"></iframe>', faq = nfajFaq, media } = {}) {
  return mockHttp((url, options) => {
    if (url.includes('/works/view/')) return nfajFacts(completeness);
    if (url.includes('/support5.html')) return faq;
    if (url.includes('/works/playen/')) return player;
    if (media) return media(url, options);
    throw new Error(`Unexpected request ${url}`);
  }, null);
}
function nzTitle(overrides = {}, videoOverrides = {}) {
  return { id: 1, title: 'Film 1', meta: { html_url: nzCandidate.source_url }, media_type_category: 'Film', is_episode: false,
    production: { start_date: 1966 }, cast_and_crew: { crew: [{ profile: { title: 'A Director' }, roles: [{ credit_category: 'Director' }] }] },
    hero_banner: { hero_video: { video_id: '6394657420112', account_id: '6416036801001', player_id: 'default', video_type: 'film', name: 'Film 1', description: null,
      duration: { raw: 600 }, rental: { is_rental: false, is_protected: false, price: null }, ...videoOverrides } }, ...overrides };
}
function nzDetailHttp(data, html = '<h1>Film 1</h1>', media) {
  return mockHttp((url, options) => {
    if (url.includes('/api/v3/pages/find/')) return JSON.stringify(data);
    if (url.includes('/videos/film-1/')) return html;
    if (media) return media(url, options);
    throw new Error(`Unexpected request ${url}`);
  });
}
async function caught(verifier, id, candidate, http) {
  const record = base(candidate); let error;
  try { await verifier(source(id), candidate, http, record); } catch (failure) { error = failure; }
  return { record, error };
}

test('parent verification enrichment never mutates immutable discovery candidate identifiers', async () => {
  const candidate = structuredClone(nzCandidate), before = structuredClone(candidate);
  const record = await verifyCandidate(source(NZ), candidate, nzDetailHttp(nzTitle()));
  assert.equal(record.error_code, 'NZ_BRIGHTCOVE_FREE_FULL_PLAYBACK_CONTRACT_REQUIRED');
  assert.equal(record.metadata.external_identifiers.nzonscreen_video, '6394657420112');
  assert.deepEqual(candidate, before);
  assert.notEqual(record.metadata.external_identifiers, candidate.external_identifiers);
});

test('provider API exports two scoped enumerators and two verifier hooks', () => {
  assert.deepEqual(Object.keys(enumerators), [NFAJ, NZ]); assert.deepEqual(Object.keys(verifiers), [NFAJ, NZ]);
  assert.equal(enumerators[NFAJ], enumerateNfaj); assert.equal(verifiers[NZ], verifyNzOnScreen);
});
test('NFAJ enumerates every linked page, checkpoints each page, and preserves original titles', async () => {
  const http = mockHttp((url) => { const page = Number(new URL(url).searchParams.get('page') || 1); return nfajPage([page], 90, page); }, null);
  const saves = []; http.checkpoint = async (state, candidates) => saves.push({ state, count: candidates.length });
  const result = await enumerateNfaj(source(NFAJ), http);
  assert.equal(result.status, 'ENUMERATED'); assert.equal(result.candidates.length, 90); assert.equal(result.pages, 90); assert.equal(saves.length, 90);
  assert.equal(result.candidates[0].original_title, '日本語 1'); assert.equal(result.candidates[0].director_credit, 'A Director');
  assert.equal(result.candidates[0].year, 1940); assert.equal(result.candidates[0].runtime, null); assert.equal(result.candidates[0].poster_url, null);
  assert.ok(result.candidates[0].listing_evidence); assert.equal(http.calls[0].url, `${JAPAN}/robots.txt`);
});
test('NZ covers both Film and Short film with uncapped complete pagination and checkpoints', async () => {
  const http = nzCatalogue((url) => { const u = new URL(url), page = Number(u.searchParams.get('page_number')), category = u.searchParams.get('media_category');
    return nzBatch([nzItem((category === 'Film' ? 0 : 1000) + page, category)], page, category === 'Film' ? 95 : 4); });
  const saves = []; http.checkpoint = async (state, candidates) => saves.push({ state, count: candidates.length });
  const result = await enumerateNzOnScreen(source(NZ), http);
  assert.equal(result.status, 'ENUMERATED'); assert.equal(result.candidates.length, 99); assert.equal(result.pages, 99);
  assert.deepEqual(result.advertised_totals, { Film: 95, 'Short film': 4 }); assert.equal(saves.length, 99);
  assert.equal(result.candidates[0].runtime, 10); assert.equal(result.candidates[0].external_id, '1');
  assert.equal(http.calls[0].url, `${NEW_ZEALAND}/robots.txt`);
});
test('NZ last-page page_size is an actual count, not capacity; stop at total without requesting an invalid extra page', async () => {
  const pages = [];
  const http = nzCatalogue((url) => {
    const u = new URL(url), category = u.searchParams.get('media_category'), page = Number(u.searchParams.get('page_number'));
    if (category === 'Short film') return nzBatch([], 1, 0, 0);
    pages.push(page); assert.ok(page <= 2);
    return page === 1 ? nzBatch([nzItem(1), nzItem(2)], 1, 3, 2) : nzBatch([nzItem(3)], 2, 3, 1);
  });
  const result = await enumerateNzOnScreen(source(NZ), http);
  assert.equal(result.enumeration_complete, true); assert.equal(result.candidates.length, 3); assert.deepEqual(pages, [1, 2]);
});
test('film-category shorts under all-series are not lost during enumeration', async () => {
  const http = nzCatalogue((url) => { const category = new URL(url).searchParams.get('media_category'); return category === 'Film' ? nzBatch([], 1, 0) : nzBatch([{ ...nzItem(1, 'Short film'), html_url: `${NEW_ZEALAND}/all-series/animation/film-1/` }], 1, 1); });
  const result = await enumerateNzOnScreen(source(NZ), http);
  assert.equal(result.enumeration_complete, true); assert.match(result.candidates[0].source_url, /all-series/);
});
test('robots denies before catalogue fetch, while /admin denial does not prohibit public search', async () => {
  const http = mockHttp(() => assert.fail('A denied listing must not be requested'), 'User-agent: *\nDisallow: /en/works\n');
  const result = await enumerateNfaj(source(NFAJ), http);
  assert.equal(result.status, 'SOURCE_ROBOTS_DISALLOWED'); assert.equal(result.enumeration_complete, false); assert.equal(http.calls.length, 1);
});
test('specific agent robots group, longest allow, wildcard and crawl delay are respected', async () => {
  const policy = 'User-agent: *\nAllow: /\nUser-agent: GlobalCinemaSourceRegistry\nDisallow: /en/*\nAllow: /en/works?num=50$\nCrawl-delay: 7\n';
  const http = mockHttp(() => nfajPage([1]), policy);
  assert.equal((await enumerateNfaj(source(NFAJ), http)).status, 'ENUMERATED');
  assert.equal(http.calls[1].options.intervalMs, 7000);
  const denied = mockHttp(() => assert.fail('Specific group denial must win'), policy.replace('Allow: /en/works?num=50$\n', ''));
  assert.equal((await enumerateNfaj(source(NFAJ), denied)).status, 'SOURCE_ROBOTS_DISALLOWED');
});
test('robots 403, 429, 503, and non-policy HTML fail closed without catalogue access', async () => {
  for (const status of [403, 429, 503]) {
    const http = mockHttp(() => assert.fail('robots failure cannot be ignored'), new SourceAccessError(status === 503 ? 'SOURCE_UNAVAILABLE' : 'SOURCE_ACCESS_BLOCKED', `${NEW_ZEALAND}/robots.txt`, status));
    const result = await enumerateNzOnScreen(source(NZ), http);
    assert.equal(result.enumeration_complete, false); assert.equal(result.http_status, status); assert.equal(http.calls.length, 1);
  }
  const http = mockHttp(() => assert.fail('robots HTML cannot be ignored'), '<html><title>Unknown protection</title></html>');
  assert.equal((await enumerateNzOnScreen(source(NZ), http)).status, 'SOURCE_ROBOTS_UNCONFIRMED');
});
test('access denial retains NFAJ discovery and resumable next page without retries', async () => {
  const http = mockHttp((url) => { if (new URL(url).searchParams.get('page') === '2') throw new SourceAccessError('SOURCE_ACCESS_BLOCKED', url, 403); return nfajPage([1], 3); }, null);
  const candidates = []; const failed = await enumerateNfaj(source(NFAJ), http, candidates);
  assert.equal(failed.status, 'SOURCE_ACCESS_BLOCKED'); assert.equal(failed.candidates.length, 1); assert.equal(failed.enumeration_complete, false);
  const resumed = mockHttp((url) => { const page = Number(new URL(url).searchParams.get('page')); assert.ok(page >= 2); return nfajPage([page], 3, page); }, null);
  resumed.enumerationState = http.enumerationState;
  const result = await enumerateNfaj(source(NFAJ), resumed, candidates);
  assert.equal(result.status, 'ENUMERATED'); assert.equal(result.candidates.length, 3); assert.equal(result.pages, 3);
});
test('NZ resumability retains completed category, next page and partial candidates', async () => {
  const http = nzCatalogue((url) => { const u = new URL(url), page = Number(u.searchParams.get('page_number')), category = u.searchParams.get('media_category');
    if (category === 'Short film') throw new SourceAccessError('SOURCE_ACCESS_BLOCKED', url, 429);
    return nzBatch([nzItem(page)], page, 2); });
  const candidates = []; const partial = await enumerateNzOnScreen(source(NZ), http, candidates);
  assert.equal(partial.enumeration_complete, false); assert.equal(partial.candidates.length, 2); assert.equal(http.enumerationState.category_index, 1);
  const resumed = nzCatalogue((url) => { const u = new URL(url); assert.equal(u.searchParams.get('media_category'), 'Short film'); return nzBatch([nzItem(3, 'Short film')], 1, 1); });
  resumed.enumerationState = http.enumerationState;
  const result = await enumerateNzOnScreen(source(NZ), resumed, candidates);
  assert.equal(result.enumeration_complete, true); assert.equal(result.candidates.length, 3);
});
test('completed resume state without original candidates cannot claim complete enumeration', async () => {
  const nfajHttp = mockHttp(() => nfajPage([1]), null); await enumerateNfaj(source(NFAJ), nfajHttp);
  const resumed = mockHttp(() => assert.fail('completed NFAJ should not refetch'), null); resumed.enumerationState = nfajHttp.enumerationState;
  assert.equal((await enumerateNfaj(source(NFAJ), resumed)).status, 'SOURCE_RESUME_CANDIDATES_MISSING');
  const nzHttp = nzCatalogue((url) => new URL(url).searchParams.get('media_category') === 'Film' ? nzBatch([nzItem(1)], 1, 1) : nzBatch([], 1, 0));
  await enumerateNzOnScreen(source(NZ), nzHttp);
  const nzResume = nzCatalogue(() => assert.fail('completed NZ should not refetch listings')); nzResume.enumerationState = nzHttp.enumerationState;
  assert.equal((await enumerateNzOnScreen(source(NZ), nzResume)).status, 'SOURCE_RESUME_CANDIDATES_MISSING');
});
test('NFAJ repeated page and missing pagination fail closed with retained prior candidates', async () => {
  const http = mockHttp(() => nfajPage([1], 3), null); const result = await enumerateNfaj(source(NFAJ), http);
  assert.equal(result.status, 'SOURCE_PAGINATION_ERROR'); assert.equal(result.candidates.length, 1);
  const missing = mockHttp(() => '<a href="/en/works/view/1"><h2 class="work-result-heading">Film 1</h2></a>', null);
  assert.equal((await enumerateNfaj(source(NFAJ), missing)).status, 'NFAJ_PAGINATION_CONTRACT_MISSING');
});
test('NZ repeated, short, premature-empty and changing-total pages fail closed', async () => {
  for (const defect of ['repeat', 'short', 'empty', 'total']) {
    const http = nzCatalogue((url) => { const page = Number(new URL(url).searchParams.get('page_number')); if (page === 1) return nzBatch([nzItem(1)], 1, 3);
      if (defect === 'repeat') return nzBatch([nzItem(1)], page, 3);
      if (defect === 'total') return nzBatch([nzItem(2)], page, 4);
      return nzBatch([], page, 3); });
    const result = await enumerateNzOnScreen(source(NZ), http);
    assert.equal(result.enumeration_complete, false); assert.equal(result.candidates.length, 1);
  }
});
test('NZ malformed category/pagination/record contracts never become empty success', async () => {
  const missing = mockHttp(() => JSON.stringify({ categories: [] }));
  assert.equal((await enumerateNzOnScreen(source(NZ), missing)).status, 'NZ_FILM_CATEGORIES_CONTRACT_MISSING');
  const pagination = nzCatalogue(() => JSON.stringify({ results: [], pagination: { total_count: 0 } }));
  assert.equal((await enumerateNzOnScreen(source(NZ), pagination)).status, 'NZ_SEARCH_PAGINATION_INVALID');
  const untrusted = nzCatalogue(() => nzBatch([{ ...nzItem(1), html_url: 'https://unofficial.example/film/' }], 1, 1));
  assert.equal((await enumerateNzOnScreen(source(NZ), untrusted)).status, 'NZ_SEARCH_ITEM_CONTRACT_INVALID');
});
test('NFAJ complete listing + free FAQ + iframe remains pending, prohibits embeds, no NII request', async () => {
  const http = nfajDetailHttp(); const { record, error } = await caught(verifyNfaj, NFAJ, nfajCandidate, http);
  assert.equal(error.code, 'NFAJ_OFFICIAL_PLAYER_HOST_REVIEW_REQUIRED'); assert.equal(record.official_or_rights_verified, true);
  assert.equal(record.full_film_verified, false); assert.equal(record.free_verified, false); assert.equal(record.live_check_status, 'PENDING');
  assert.equal(record.embed_status, 'PROHIBITED'); assert.equal(record.embed_url_if_allowed, null); assert.equal(record.embed_working, false);
  assert.equal(record.runtime, 10); assert.equal(record.metadata.original_title, '日本語 1'); assert.ok(record.metadata.alternate_titles.includes('Romaji 1'));
  assert.equal(record.metadata.director_credit, 'A Director'); assert.equal(record.metadata.year, 1940);
  assert.ok(http.calls.every((call) => new URL(call.url).origin === JAPAN)); assert.equal(deriveWatchState(record), 'NO_VERIFIED_FREE_STREAM');
});
test('NFAJ title-specific incomplete films are rejected before FAQ/player access; unknown completeness stays pending', async () => {
  const http = nfajDetailHttp({ completeness: 'incomplete' }); const rejected = await caught(verifyNfaj, NFAJ, nfajCandidate, http);
  assert.equal(rejected.error.code, 'NFAJ_INCOMPLETE_FILM'); assert.equal(rejected.record.lifecycle_status, 'REJECTED'); assert.equal(http.calls.length, 2);
  const unknown = await caught(verifyNfaj, NFAJ, nfajCandidate, nfajDetailHttp({ completeness: '' }));
  assert.equal(unknown.error.code, 'NFAJ_FILM_COMPLETENESS_UNKNOWN'); assert.equal(unknown.record.lifecycle_status, 'REVIEW');
});
test('NFAJ free terms/player title mismatch fail without any live pass', async () => {
  const terms = await caught(verifyNfaj, NFAJ, nfajCandidate, nfajDetailHttp({ faq: 'Terms have changed.' }));
  assert.equal(terms.error.code, 'NFAJ_CURRENT_FREE_TERMS_UNCONFIRMED'); assert.equal(terms.record.free_verified, false);
  const mismatch = await caught(verifyNfaj, NFAJ, nfajCandidate, nfajDetailHttp({ player: '<h1>Another Film</h1>' }));
  assert.equal(mismatch.error.code, 'NFAJ_PLAYER_IDENTITY_MISMATCH'); assert.equal(mismatch.record.live_check_status, 'PENDING');
});
test('NZ trailer-detail hero uses h3 when h1 is absent; still reject the trailer by title API identity', async () => {
  const result = await caught(verifyNzOnScreen, NZ, nzCandidate, nzDetailHttp(nzTitle({}, { video_type: 'trailer' }), '<main><h3>Film 1</h3></main>'));
  assert.equal(result.error.code, 'NZ_NOT_COMPLETE_FILM'); assert.equal(result.record.lifecycle_status, 'REJECTED');
});
test('NZ official full/free metadata cannot pass Brightcove live playback or authorize embedding', async () => {
  const http = nzDetailHttp(nzTitle()); const { record, error } = await caught(verifyNzOnScreen, NZ, nzCandidate, http);
  assert.equal(error.code, 'NZ_BRIGHTCOVE_FREE_FULL_PLAYBACK_CONTRACT_REQUIRED'); assert.equal(record.official_or_rights_verified, true);
  assert.equal(record.full_film_verified, false); assert.equal(record.free_verified, false); assert.equal(record.live_check_status, 'PENDING');
  assert.equal(record.embed_status, 'PROHIBITED'); assert.equal(record.metadata.director_credit, 'A Director'); assert.equal(record.metadata.year, 1966);
  assert.ok(http.calls.every((call) => new URL(call.url).origin === NEW_ZEALAND)); assert.equal(deriveWatchState(record), 'NO_VERIFIED_FREE_STREAM');
});
test('NZ rental/paid, trailers, excerpts/clips, TV and episodes are rejected', async () => {
  const cases = [
    [nzTitle({}, { rental: { is_rental: true, is_protected: true, price: 6.99 } }), 'NZ_PAID_OR_RENTAL'],
    [nzTitle({}, { rental: { is_rental: false, price: 1 } }), 'NZ_PAID_OR_RENTAL'],
    [nzTitle({}, { video_type: 'trailer' }), 'NZ_NOT_COMPLETE_FILM'],
    [nzTitle({}, { video_type: 'excerpt' }), 'NZ_NOT_COMPLETE_FILM'],
    [nzTitle({}, { description: 'An excerpt from this film' }), 'NZ_NOT_COMPLETE_FILM'],
    [nzTitle({}, { name: 'A clip from the film' }), 'NZ_NOT_COMPLETE_FILM'],
    [nzTitle({ media_type_category: 'Television' }), 'NZ_NOT_A_FILM'],
    [nzTitle({ is_episode: true }), 'NZ_NOT_A_FILM'],
  ];
  for (const [data, code] of cases) {
    const { record, error } = await caught(verifyNzOnScreen, NZ, nzCandidate, nzDetailHttp(data));
    assert.equal(error.code, code); assert.equal(record.lifecycle_status, 'REJECTED'); assert.equal(record.free_verified, false); assert.equal(record.full_film_verified, false);
  }
});
test('NZ absent/unknown/protected playback is pending, never public film evidence', async () => {
  const cases = [
    [nzTitle({ hero_banner: { hero_video: null } }), 'NZ_PUBLIC_TITLE_PLAYER_UNAVAILABLE'],
    [nzTitle({}, { video_type: 'unknown' }), 'NZ_FULL_FILM_CLASSIFICATION_UNKNOWN'],
    [nzTitle({}, { rental: { is_rental: false, is_protected: true } }), 'NZ_AUTHENTICATED_OR_PROTECTED_PLAYER'],
    [nzTitle({}, { rental: null }), 'NZ_CURRENT_FREE_STATUS_UNKNOWN'],
    [nzTitle({}, { rental: { is_rental: false, is_protected: false, price: 'unknown' } }), 'NZ_CURRENT_FREE_STATUS_UNKNOWN'],
    [nzTitle({}, { duration: null }), 'NZ_FULL_FILM_IDENTITY_OR_RUNTIME_UNKNOWN'],
  ];
  for (const [data, code] of cases) {
    const { record, error } = await caught(verifyNzOnScreen, NZ, nzCandidate, nzDetailHttp(data));
    assert.equal(error.code, code); assert.equal(record.lifecycle_status, 'REVIEW'); assert.equal(record.live_check_status, 'PENDING'); assert.equal(record.free_verified, false);
  }
});
test('NZ detail title/ID/canonical mismatch is never accepted as official live evidence', async () => {
  for (const data of [nzTitle({ title: 'Another Film' }), nzTitle({ id: 2 }), nzTitle({ meta: { html_url: 'https://unofficial.example/film/' } })]) {
    const { record, error } = await caught(verifyNzOnScreen, NZ, nzCandidate, nzDetailHttp(data));
    assert.equal(error.code, 'NZ_DETAIL_IDENTITY_MISMATCH'); assert.equal(record.free_verified, false); assert.equal(record.live_check_status, 'PENDING');
  }
});
test('unsafe hosts and explicitly incomplete titles are rejected before fetching anything', async () => {
  for (const [verifier, id, candidate] of [[verifyNfaj, NFAJ, nfajCandidate], [verifyNzOnScreen, NZ, nzCandidate]]) {
    const http = mockHttp(() => assert.fail('Do not fetch untrusted/incomplete records'));
    const clip = await caught(verifier, id, { ...candidate, title: 'Film 1 clip' }, http); assert.equal(clip.record.lifecycle_status, 'REJECTED');
    const untrusted = await caught(verifier, id, { ...candidate, source_url: 'https://unofficial.example/film/' }, http);
    assert.ok(untrusted.error); assert.equal(http.calls.length, 0);
  }
});
test('only the existing complete HLS + duration + media HEAD gate can produce a live pass', async () => {
  const mediaCalls = [];
  const media = (url, options) => { mediaCalls.push({ url, options });
    return options.method === 'HEAD' ? { status: 200, headers: { 'content-length': '100', 'content-type': 'video/mp2t' } } : '#EXTM3U\n#EXTINF:600,\nfilm.ts\n#EXT-X-ENDLIST\n'; };
  const http = nfajDetailHttp({ player: '<h1>Film 1</h1><video><source src="/media/film.m3u8"></video>', media });
  const { record, error } = await caught(verifyNfaj, NFAJ, nfajCandidate, http);
  assert.equal(error, undefined); assert.equal(record.live_check_status, 'PASS'); assert.equal(record.full_film_verified, true); assert.equal(record.free_verified, true);
  assert.equal(deriveWatchState(record), 'WATCH_FREE_EXTERNALLY'); assert.equal(record.embed_status, 'PROHIBITED');
  assert.equal(mediaCalls.length, 2); assert.equal(mediaCalls[1].options.method, 'HEAD'); assert.ok(record.verification_evidence.some((item) => item.kind === 'LIVE_SOURCE'));
});
test('NZ direct official video HLS also requires the existing gate; a bogus HLS response never passes', async () => {
  const html = '<h1>Film 1</h1><video data-video-id="6394657420112" src="/media/film.m3u8"></video>';
  const http = nzDetailHttp(nzTitle(), html, (_url, options) => options.method === 'HEAD' ? { headers: { 'content-length': '100', 'content-type': 'video/mp2t' } } : '#EXTM3U\n#EXTINF:600,\nfilm.ts\n#EXT-X-ENDLIST\n');
  const passed = await caught(verifyNzOnScreen, NZ, nzCandidate, http);
  assert.equal(passed.error, undefined); assert.equal(passed.record.live_check_status, 'PASS'); assert.equal(deriveWatchState(passed.record), 'WATCH_FREE_EXTERNALLY');
  const bogus = await caught(verifyNzOnScreen, NZ, nzCandidate, nzDetailHttp(nzTitle(), html, () => '<h1>Not media</h1>'));
  assert.equal(bogus.error.code, 'SOURCE_NOT_HLS'); assert.equal(bogus.record.free_verified, false);
});
test('HLS duration mismatch, missing endlist, encryption, inaccessible HEAD and off-domain child stay pending', async () => {
  const cases = [
    ['#EXTM3U\n#EXTINF:1,\nfilm.ts\n#EXT-X-ENDLIST\n', 'SOURCE_DURATION_CONFLICT'],
    ['#EXTM3U\n#EXTINF:600,\nfilm.ts\n', 'SOURCE_NOT_COMPLETE_VOD'],
    ['#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:600,\nfilm.ts\n#EXT-X-ENDLIST\n', 'SOURCE_ENCRYPTED_REQUIRES_PLAYER_REVIEW'],
    ['#EXTM3U\n#EXTINF:600,\nfilm.ts\n#EXT-X-ENDLIST\n', 'SOURCE_MEDIA_UNCONFIRMED'],
    ['#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nhttps://cdn.example/film.m3u8\n', 'SOURCE_HOST_NOT_IN_AUDITED_CONTRACT'],
  ];
  for (const [playlist, code] of cases) {
    const http = nfajDetailHttp({ player: '<h1>Film 1</h1><video src="/media/film.m3u8"></video>', media: (_url, options) => options.method === 'HEAD' ? { headers: { 'content-length': '0' } } : playlist });
    const { record, error } = await caught(verifyNfaj, NFAJ, nfajCandidate, http);
    assert.equal(error.code, code); assert.equal(record.live_check_status, 'PENDING'); assert.equal(record.free_verified, false);
    assert.ok(http.calls.every((call) => new URL(call.url).origin === JAPAN));
  }
});
test('pending rechecks clear stale full/free/live flags and previously allowed embed fields', async () => {
  const record = { ...base(nzCandidate), full_film_verified: true, free_verified: true, live_check_status: 'PASS', embed_status: 'PERMITTED', embed_working: true, embed_url_if_allowed: `${NEW_ZEALAND}/embed/1` };
  await assert.rejects(() => verifyNzOnScreen(source(NZ), nzCandidate, nzDetailHttp(nzTitle()), record), { code: 'NZ_BRIGHTCOVE_FREE_FULL_PLAYBACK_CONTRACT_REQUIRED' });
  assert.equal(record.full_film_verified, false); assert.equal(record.free_verified, false); assert.equal(record.live_check_status, 'PENDING');
  assert.equal(record.embed_status, 'PROHIBITED'); assert.equal(record.embed_working, false); assert.equal(record.embed_url_if_allowed, null);
  assert.equal(deriveWatchState(record), 'NO_VERIFIED_FREE_STREAM');
});
test('NZ unbound or wrong-video media and guessed API hls_url are never probed', async () => {
  for (const html of ['<h1>Film 1</h1><video src="/media/other.m3u8"></video>', '<h1>Film 1</h1><video data-video-id="123" src="/media/other.m3u8"></video>']) {
    const http = nzDetailHttp(nzTitle({}, { hls_url: `${NEW_ZEALAND}/media/guessed.m3u8` }), html, () => assert.fail('Unbound media must not be requested'));
    const { record, error } = await caught(verifyNzOnScreen, NZ, nzCandidate, http);
    assert.equal(error.code, 'NZ_BRIGHTCOVE_FREE_FULL_PLAYBACK_CONTRACT_REQUIRED'); assert.equal(record.free_verified, false);
  }
});
test('manifest access denial and media robots restrictions stop live checks without retries or media GETs', async () => {
  const denied = nfajDetailHttp({ player: '<h1>Film 1</h1><video src="/media/film.m3u8"></video>', media: (url) => { throw new SourceAccessError('SOURCE_ACCESS_BLOCKED', url, 403); } });
  const blocked = await caught(verifyNfaj, NFAJ, nfajCandidate, denied);
  assert.equal(blocked.error.code, 'SOURCE_ACCESS_BLOCKED'); assert.equal(blocked.record.free_verified, false);
  assert.equal(denied.calls.filter((call) => call.url.endsWith('.m3u8')).length, 1);
  const policy = 'User-agent: *\nAllow: /\nDisallow: /media/\n';
  const restricted = mockHttp((url) => {
    if (url.includes('/works/view/')) return nfajFacts();
    if (url.includes('/support5.html')) return nfajFaq;
    if (url.includes('/works/playen/')) return '<h1>Film 1</h1><video src="/media/film.m3u8"></video>';
    assert.fail('Robots-denied media must not be requested');
  }, policy);
  const outcome = await caught(verifyNfaj, NFAJ, nfajCandidate, restricted);
  assert.equal(outcome.error.code, 'SOURCE_ROBOTS_DISALLOWED'); assert.equal(outcome.record.live_check_status, 'PENDING');
});
