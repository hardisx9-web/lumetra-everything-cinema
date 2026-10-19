import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enumerateSource } from '../catalogues.mjs';
import { verifyCandidate } from '../verification.mjs';
import { robotsPolicy, ProviderHttp } from '../provider-policy.mjs';
import { checkpointHttp } from '../enumeration-checkpoint.mjs';
import { SourceAccessError } from '../http.mjs';

const source = id => ({ id, name: id, official_url: 'https://www.filminstitutet.se/', embed_policy: 'EXTERNAL_ONLY' });
const doc = (body, url) => ({ body, url, status: 200, sha256: 'fixture', headers: {} });
const film = id => ({ id, type: 'film', name: `Film ${id}`, full_url_slug: `films/film-${id}`, is_auth_required: true,
  metas: [{ key: 'title', value: `Film ${id}` }, { key: 'cost', value: 'Gratis' }, { key: 'director', value: 'Director' }, { key: 'year', value: '1920' }],
  assets: [{ id, type: 'video', linked_type: 'film', accessibility: 'everyone', duration: 600 }] });

const BFI_SEARCH = 'https://search-es.player.bfi.org.uk/prod-films/_search';
const bfiHit = (nid, extra = {}) => ({ _source: { nid, uuid: '34076722-44e4-53e5-ab82-e4288e27cd5f', title: 'A Bedtime Story', original_title: 'Original Bedtime Story', url: `/free/film/watch-film-${nid}-1959-online`, pillar: 'free', release_date: '1959', director: [], country: 'United Kingdom', duration: '8', genre: ['Amateur film'], archive: ['Yorkshire Film Archive'], standfirst: '<p>Authoritative synopsis</p>', ...extra }, sort: [nid] });
const bfiResponse = (hits, total = hits.length) => ({ ...doc('', BFI_SEARCH), data: { timed_out: false, _shards: { failed: 0 }, hits: { total: { value: total, relation: 'eq' }, hits } } });

test('BFI uses exact free structured search, keyword nid pagination, authoritative fields and source-local identifiers', async () => {
  const calls = [];
  const out = await enumerateSource(source('bfi_player_free'), { json: async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body, method: options.method });
    const index = calls.length - 1;
    return bfiResponse([bfiHit(String(12122 + index), index === 1 ? { director: ['Director One', 'Director Two'] } : {})], 3);
  } });
  assert.equal(out.candidates.length, 3); assert.equal(out.enumeration_complete, true);
  assert.deepEqual(calls.map(c => c.body.search_after), [undefined, ['12122'], ['12123']]);
  assert.ok(calls.every(c => c.url === BFI_SEARCH && c.method === 'POST' && c.body.query.bool.filter[0].term['pillar.raw'] === 'free' && !('from' in c.body)));
  assert.deepEqual(calls[0].body.sort, [{ nid: 'asc' }]);
  const item = out.candidates[0];
  assert.equal(item.external_id, '12122'); assert.deepEqual(item.external_identifiers, { bfi_nid: '12122' });
  assert.equal(item.bfi_uuid, '34076722-44e4-53e5-ab82-e4288e27cd5f'); assert.equal(item.title, 'A Bedtime Story');
  assert.equal(item.original_title, 'Original Bedtime Story'); assert.equal(item.year, 1959); assert.equal(item.director_credit, null);
  assert.deepEqual(item.countries, ['United Kingdom']); assert.equal(item.runtime, 8); assert.equal(item.synopsis, 'Authoritative synopsis');
  assert.equal(out.candidates[1].director_credit, 'Director One / Director Two'); assert.equal(item.listing_evidence.url, BFI_SEARCH);
});
test('BFI search_after enumerates all 12,058 fixture records beyond the Elasticsearch result window', async () => {
  let pages = 0;
  const out = await enumerateSource(source('bfi_player_free'), { json: async (url, options) => {
    const body = JSON.parse(options.body); pages++;
    const start = body.search_after ? Number(body.search_after[0]) - 100000 + 1 : 0;
    return bfiResponse(Array.from({ length: Math.min(body.size, 12058 - start) }, (_, i) => bfiHit(String(100000 + start + i))), 12058);
  } });
  assert.equal(out.enumeration_complete, true); assert.equal(out.candidates.length, 12058); assert.equal(out.advertised_total, 12058); assert.equal(pages, 25);
});
test('BFI interrupted structured discovery resumes at saved search_after; old sitemap checkpoint is never repurposed', async () => {
  let saved, pages = 0;
  const interrupted = await enumerateSource(source('bfi_player_free'), { checkpoint: async (state, candidates) => { saved = structuredClone({ state, candidates }); }, json: async url => {
    if (++pages === 1) return bfiResponse([bfiHit('12122')], 2);
    throw new SourceAccessError('SOURCE_UNAVAILABLE', url, 502);
  } });
  assert.equal(interrupted.enumeration_complete, false); assert.equal(interrupted.candidates.length, 1);
  const resumed = await enumerateSource(source('bfi_player_free'), { enumerationState: saved.state, enumerationCandidates: saved.candidates, json: async (url, options) => {
    assert.deepEqual(JSON.parse(options.body).search_after, ['12122']); return bfiResponse([bfiHit('12123')], 2);
  } });
  assert.equal(resumed.enumeration_complete, true); assert.equal(resumed.candidates.length, 2);
  const old = await enumerateSource(source('bfi_player_free'), { enumerationState: { queue: [] }, json: async () => assert.fail('old snapshot must not trigger search') });
  assert.equal(old.enumeration_complete, false); assert.match(old.blocker, /CHECKPOINT_CONTRACT_CHANGED/);
});
test('BFI invalid, paid, unsafe, repeated or incomplete search results fail closed without false completion', async () => {
  for (const extra of [{ pillar: 'rental' }, { nid: 'https://example.org/12122' }, { url: 'https://evil.example/free/film/watch-film' }, { url: 'https://user:secret@player.bfi.org.uk/free/film/watch-film' }, { url: '/rentals/film/paid' }, { release_date: 'invalid' }]) {
    const out = await enumerateSource(source('bfi_player_free'), { json: async () => bfiResponse([bfiHit('12122', extra)]) });
    assert.equal(out.enumeration_complete, false); assert.equal(out.candidates.length, 0);
  }
  for (const mutate of [d => { d.data.timed_out = true; }, d => { d.data._shards.failed = 1; }, d => { d.data.hits.total.relation = 'gte'; }]) {
    const d = bfiResponse([bfiHit('12122')]); mutate(d);
    assert.equal((await enumerateSource(source('bfi_player_free'), { json: async () => d })).enumeration_complete, false);
  }
  let calls = 0;
  const repeated = await enumerateSource(source('bfi_player_free'), { json: async () => { calls++; return bfiResponse([bfiHit('12122')], 2); } });
  assert.equal(calls, 2); assert.equal(repeated.enumeration_complete, false); assert.equal(repeated.candidates.length, 1);
  const absent = await enumerateSource(source('bfi_player_free'), { json: async () => bfiResponse([bfiHit('12122', { release_date: null })]) });
  assert.equal(absent.candidates[0].year, null); assert.equal(absent.enumeration_complete, true);
});
test('BFI verification refreshes exact nid metadata without HTML corruption or candidate mutation; Replay stays outside contract', async () => {
  const hit = bfiHit('12122');
  const enumeration = await enumerateSource(source('bfi_player_free'), { json: async () => bfiResponse([hit]) });
  const item = enumeration.candidates[0], before = structuredClone(item);
  const body = '<h1>A Bedtime Story</h1><div class="film-metadata-summary"><p>United Kingdom</p><p>Directed by Incorrect HTML Director</p><div aria-label="Release Date">2001</div></div>';
  const json = async (url, options) => {
    assert.deepEqual(JSON.parse(options.body).query.bool.filter, [{ term: { 'pillar.raw': 'free' } }, { term: { nid: '12122' } }]);
    return bfiResponse([hit]);
  };
  const checked = await verifyCandidate(source('bfi_player_free'), item, { json, request: async url => doc(body, url) });
  assert.equal(checked.metadata.year, 1959); assert.equal(checked.metadata.director_credit, null); assert.equal(checked.metadata.original_title, 'Original Bedtime Story');
  assert.equal(checked.runtime, 8); assert.equal(checked.metadata.external_id, '12122'); assert.equal(checked.free_verified, false);
  assert.equal(checked.error_code, 'BFI_FREE_FULL_PLAYER_NOT_OFFERED'); assert.deepEqual(item, before);
  const redirected = await verifyCandidate(source('bfi_player_free'), item, { json, request: async () => doc(body, 'https://replay.bfi.org.uk/video/34076722-44e4-53e5-ab82-e4288e27cd5f') });
  assert.equal(redirected.error_code, 'BFI_DETAIL_OUTSIDE_FREE_CONTRACT'); assert.equal(redirected.watch_state, 'NO_VERIFIED_FREE_STREAM');
  assert.equal(redirected.metadata.external_identifiers.bfi_nid, '12122'); assert.deepEqual(item, before);
  assert.equal(redirected.http_status, 200); assert.equal(redirected.verification_evidence.find(e => e.kind === 'DETAIL_REDIRECT').value.final_url, 'https://replay.bfi.org.uk/video/34076722-44e4-53e5-ab82-e4288e27cd5f');
  const wrong = await verifyCandidate(source('bfi_player_free'), item, { json: async () => bfiResponse([bfiHit('12123')]), request: async () => assert.fail('mismatched ID must not fetch detail') });
  assert.equal(wrong.error_code, 'BFI_SEARCH_IDENTITY_MISMATCH');
  const unsafe = await verifyCandidate(source('bfi_player_free'), { ...item, source_url: 'https://evil.example/free/film/watch-film' }, { json: async () => assert.fail('unsafe input must not fetch search') });
  assert.equal(unsafe.error_code, 'SOURCE_HOST_NOT_IN_AUDITED_CONTRACT');
});
test('Eye traverses all offsets even for an API page smaller than requested; trailers are not film assets', async () => {
  const offsets = [];
  const out = await enumerateSource(source('eye_film_player'), { json: async (url, options) => {
    const query = JSON.parse(options.body).query, offset = Number(query.match(/offset: (\d+)/)[1]); offsets.push(offset);
    return { ...doc('', url), data: { data: { ArticleList: { pagination: { offset, count: 1, total_count: 3 }, items: [film(offset + 1)] } } } };
  } });
  assert.deepEqual(offsets, [0, 1, 2]); assert.equal(out.candidates.length, 3); assert.equal(out.enumeration_complete, true);
  assert.equal(out.candidates[0].runtime, 10);
});
test('Eye repeating or premature empty pages retain discovery without false completion', async () => {
  let calls = 0;
  const out = await enumerateSource(source('eye_film_player'), { json: async (url, options) => {
    const offset = Number(JSON.parse(options.body).query.match(/offset: (\d+)/)[1]); calls++;
    return { ...doc('', url), data: { data: { ArticleList: { pagination: { offset, count: 1, total_count: 10 }, items: [film(1)] } } } };
  } });
  assert.equal(calls, 2); assert.equal(out.candidates.length, 1); assert.equal(out.enumeration_complete, false);
});
test('Eye paid titles rejected, free account-gated titles pending, mismatched title IDs never accepted', async () => {
  const item = { registry_source_id: 'eye_film_player', title: 'Film 1', source_url: 'https://player.eyefilm.nl/nl/films/film-1', external_id: '1', raw: { full_url_slug: 'films/film-1' } };
  const verify = article => verifyCandidate(source('eye_film_player'), item, { json: async () => ({ ...doc('', 'https://api.audienceplayer.com/graphql/9/user'), data: { data: { Article: article } } }) });
  const paid = await verify({ ...film(1), products: [{ price: 5 }] });
  assert.equal(paid.lifecycle_status, 'REJECTED'); assert.equal(paid.free_verified, false);
  const free = await verify(film(1)); assert.equal(free.error_code, 'EYE_FREE_FILM_REQUIRES_AUTHORIZED_ACCOUNT'); assert.equal(free.watch_state, 'NO_VERIFIED_FREE_STREAM');
  const wrong = await verify(film(2)); assert.equal(wrong.error_code, 'EYE_ARTICLE_IDENTITY_MISMATCH');
});
test('BFI HTTP 200 and free full-player offer are not a live proof; interviews rejected', async () => {
  const item = { title: 'slug', title_is_slug: true, source_url: 'https://player.bfi.org.uk/free/film/watch-film-online' };
  const body = '<h1>Film</h1><div class="film-metadata-summary"><div aria-label="Genre">Drama</div><div aria-label="Duration">10mins</div><div aria-label="Release Date">1920</div><p>Directed by Director</p></div><a id="play-film" data-video-id="123" data-ac="456">Watch for free</a><video data-pillar="free" data-video-type="film" data-ref-id="123" data-acid="456"></video>';
  const checked = await verifyCandidate(source('bfi_player_free'), item, { request: async url => doc(body, url) });
  assert.equal(checked.error_code, 'BFI_BRIGHTCOVE_ANONYMOUS_PLAYBACK_CONTRACT_REQUIRED'); assert.equal(checked.watch_state, 'NO_VERIFIED_FREE_STREAM');
  assert.equal(checked.metadata.director_credit, 'Director');
  const interview = await verifyCandidate(source('bfi_player_free'), item, { request: async url => doc(body.replace('>Drama<', '>Short interview<'), url) });
  assert.equal(interview.lifecycle_status, 'REJECTED'); assert.equal(interview.full_film_verified, false);
});
test('current Cinemateket links retained as partial discovery on observed geo restriction, no auth/token replay', async () => {
  const calls = [];
  const out = await enumerateSource(source('cinemateket_play_sweden'), { request: async (url, options) => {
    calls.push({ url, options });
    if (url === 'https://www.filminstitutet.se/') return doc('<a href="https://www.cinemateketplay.se/">Current service</a>', url);
    if (url === 'https://www.cinemateketplay.se/') return doc('<p>Fritt 0 kr</p>', url);
    return doc('<a href="https://play.cinemateketplay.se/watch/id1">Film 1920</a><script>{"isOpenServiceActive":false,"geoipCountry":"AE"}</script>', url);
  } });
  assert.equal(out.candidates.length, 1); assert.equal(out.enumeration_complete, false); assert.equal(out.status, 'SOURCE_GEO_RESTRICTED');
  assert.ok(calls.every(call => !call.options)); assert.ok(!JSON.stringify(out).includes('sessionToken'));
});
test('Angel and Shemaroo audit rights-holder channel links and require API key rather than assume licensing inventory free', async () => {
  const saved = process.env.YOUTUBE_API_KEY; delete process.env.YOUTUBE_API_KEY;
  try {
    for (const id of ['angel_digital', 'shemaroo']) {
      const out = await enumerateSource(source(id), { request: async url => doc('<a href="https://www.youtube.com/channel/UC123">Official outlet</a>', url) });
      assert.equal(out.status, 'SOURCE_API_CREDENTIAL_REQUIRED'); assert.equal(out.candidates.length, 0); assert.equal(out.enumeration_complete, false);
      assert.equal(out.ownership_evidence.value.channels.length, 1);
    }
  } finally { if (saved !== undefined) process.env.YOUTUBE_API_KEY = saved; }
});
test('rights-holder channels traverse every uploads token, verify uploader identity, and never turn API visibility into live playback', async () => {
  const saved = process.env.YOUTUBE_API_KEY; process.env.YOUTUBE_API_KEY = 'fixture-key-not-real';
  const calls = [];
  try {
    const out = await enumerateSource(source('shemaroo'), { request: async url => doc('<a href="https://www.youtube.com/channel/UC123">Official</a>', url), json: async url => {
      const u = new URL(url); const resource = u.pathname.split('/').at(-1); calls.push(resource + ':' + (u.searchParams.get('pageToken') || ''));
      if (resource === 'channels') return { data: { items: [{ id: 'UC123', snippet: { title: 'Official' }, contentDetails: { relatedPlaylists: { uploads: 'UU123' } } }] } };
      if (resource === 'playlistItems') { const p = Number(u.searchParams.get('pageToken') || 1); return { data: { items: [{ contentDetails: { videoId: `video00000${p}` } }], ...(p < 3 ? { nextPageToken: String(p + 1) } : {}) } }; }
      return { data: { items: [{ id: u.searchParams.get('id'), snippet: { title: 'Full Movie', channelId: 'UC123' }, status: { privacyStatus: 'public' } }] } };
    } });
    assert.equal(out.candidates.length, 3); assert.equal(out.pages, 3); assert.equal(out.enumeration_complete, true);
    const record = await verifyCandidate(source('shemaroo'), out.candidates[0], {});
    assert.equal(record.official_or_rights_verified, true); assert.equal(record.free_verified, false); assert.equal(record.watch_state, 'NO_VERIFIED_FREE_STREAM');
    assert.ok(!JSON.stringify(out).includes('fixture-key-not-real'));
  } finally { if (saved === undefined) delete process.env.YOUTUBE_API_KEY; else process.env.YOUTUBE_API_KEY = saved; }
});

test('robots longest-match, wildcard, specific-agent and crawl-delay controls enforced', () => {
  const body = 'User-agent: *\nDisallow: /search/\nDisallow: /core/\nAllow: /core/*.js$\nCrawl-delay: 2';
  assert.equal(robotsPolicy(body, 'https://example.org/search/free?q=').allowed, false);
  assert.equal(robotsPolicy(body, 'https://example.org/core/a.js').allowed, true);
  assert.equal(robotsPolicy(body, 'https://example.org/core/a.html').allowed, false);
  assert.equal(robotsPolicy(body, 'https://example.org/free').intervalMs, 2000);
  assert.equal(robotsPolicy('User-agent: *\nAllow: /\nUser-agent: GlobalCinemaSourceRegistry\nDisallow: /', 'https://example.org/free').allowed, false);
});
test('robots denied target not fetched and redirect target policy checked before following', async () => {
  const saved = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url) => { calls.push(url); if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /denied'); return new Response('', { status: 302, headers: { location: '/denied' } }); };
  try { await assert.rejects(new ProviderHttp({ intervalMs: 0 }).request('https://example.org/start'), e => e.code === 'SOURCE_ROBOTS_DISALLOWED'); assert.ok(!calls.some(url => url.endsWith('/denied'))); }
  finally { globalThis.fetch = saved; }
});
test('queued provider requests stop when another worker receives access denial', async () => {
  const saved = globalThis.fetch; const calls = [];
  globalThis.fetch = async url => { calls.push(url); if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /'); return new Response('Denied', { status: 429 }); };
  try {
    const h = new ProviderHttp({ intervalMs: 20 });
    const attempts = await Promise.allSettled([h.request('https://example.org/one'), h.request('https://example.org/two')]);
    assert.ok(attempts.every(attempt => attempt.status === 'rejected' && attempt.reason.code === 'SOURCE_ACCESS_BLOCKED'));
    assert.equal(calls.filter(url => !url.endsWith('/robots.txt')).length, 1);
  } finally { globalThis.fetch = saved; }
});

test('page checkpoint persists next cursor and candidates across process reconstruction', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cinema-checkpoint-'));
  try {
    const s = source('eye_film_player'); const h = await checkpointHttp(s, directory);
    await h.checkpoint({ offset: 100 }, [{ source_url: 'https://player.eyefilm.nl/nl/films/film-1' }]);
    const next = await checkpointHttp(s, directory); assert.equal(next.enumerationState.offset, 100); assert.equal(next.enumerationCandidates.length, 1);
    await assert.rejects(checkpointHttp({ ...s, name: 'Changed policy' }, directory));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
