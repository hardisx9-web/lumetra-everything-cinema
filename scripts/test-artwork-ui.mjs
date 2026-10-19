import test from 'node:test';
import assert from 'node:assert/strict';
import { artworkFor, artworkLabel, verifiedArtwork, posterMarkup, imageUrl, disjointProgramme, PROGRAMME_SECTIONS, sessionProgrammeSeed, textureImageUrl } from '../public/artwork-ui.js';
import { createCinemaHistoryChapters } from '../public/cinema-home.js';

const art = (extra = {}) => ({
  url: '/media/artwork/example.jpg', variants: { 640: '/media/artwork/example-640.webp' },
  source_page: 'https://example.org/source', license: 'CC BY 4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/',
  attribution: 'Example Archive', verified_at: '2026-05-01T00:00:00Z', artwork_type: 'POSTER', alt: 'Original poster, held by Example Archive', ...extra,
});
const film = (id = 'a', extra = {}) => ({ id, title: `Film ${id}`, year: 1936, director: 'A filmmaker', countries: ['France'], ...extra });
const programme = (extra = {}) => ({ seed: 'today', ...Object.fromEntries(PROGRAMME_SECTIONS.map((key) => [key, []])), ...extra });

test('API artwork wins over the legacy map without losing provenance or alt', () => {
  const actual = artworkFor(film('a', { artwork: art() }), { a: art({ url: '/wrong.jpg' }) });
  assert.equal(actual.url, '/media/artwork/example.jpg');
  assert.equal(actual.alt, 'Original poster, held by Example Archive');
  assert.equal(actual.license_url, 'https://creativecommons.org/licenses/by/4.0/');
});

test('legacy artwork is only a backwards fallback; an explicit API rejection is authoritative', () => {
  assert.equal(artworkFor(film(), { a: art() }).url, '/media/artwork/example.jpg');
  assert.equal(artworkFor(film('a', { artwork: null }), { a: art() }), null);
  assert.equal(artworkFor(film('a', { artwork: {} }), { a: art() }), null);
});

test('unreviewed, unhealthy, rights-incomplete and unverified legacy records are rejected', () => {
  for (const bad of [
    { verified_at: null }, { verified_at: 'not-a-date' }, { license_url: null }, { attribution: '' },
    { license: '' }, { source_page: 'javascript:alert(1)' }, { review_status: 'PENDING' },
    { verification_status: 'UNVERIFIED' }, { health_status: 'BROKEN' },
  ]) assert.equal(artworkFor(film(), { a: art(bad) }), null, JSON.stringify(bad));
});

test('both API epoch milliseconds and legacy ISO verification dates are accepted', () => {
  assert.equal(verifiedArtwork(art({ verified_at: 1791481735194 })).verified_at, '2026-10-08T17:48:55.194Z');
  assert.equal(verifiedArtwork(art()).verified_at, '2026-05-01T00:00:00.000Z');
});

test('URL and srcset validation exclude unsafe, empty and malformed image candidates', () => {
  for (const url of ['', '//evil.example/image.jpg', 'javascript:alert(1)', 'data:image/svg+xml,bad', '/\\evil.example/x', 'https://example.org/a b']) assert.equal(imageUrl(url), '');
  const actual = verifiedArtwork(art({ url: '', variants: { 640: '/good.webp', nope: '/bad.webp', 320: 'javascript:bad', 960: '' } }));
  assert.deepEqual(actual.variants, { 640: '/good.webp' });
  const markup = posterMarkup(film('a', { artwork: actual }));
  assert.match(markup, /src="\/good.webp"/);
  assert.doesNotMatch(markup, /src=""|nopew|javascript:/);
});

test('every poster retains film-specific metadata for load-failure fallback and escapes markup', () => {
  const item = film('a', { title: '<Danger & light>', original_title: 'Original name', director: 'A & B', artwork: art() });
  const html = posterMarkup(item);
  assert.match(html, /data-film-artwork/);
  assert.match(html, /poster-title-treatment/);
  for (const expected of ['&lt;Danger &amp; light&gt;', 'Original name', '1936', 'A &amp; B', 'France']) assert.ok(html.includes(expected), expected);
  assert.doesNotMatch(html, /<Danger/);
  assert.match(html, /Original poster, held by Example Archive/);
});

test('missing artwork reports unresolved image review without substitute art', () => {
  const html = posterMarkup(film());
  assert.doesNotMatch(html, /poster-visual-fallback/);
  assert.doesNotMatch(html, /<img|\/visuals\//);
  assert.doesNotMatch(html, /src=""/);
  assert.match(html, /Film a/);
  assert.match(html, /Authentic film artwork pending review/);
  assert.match(html, /1936 · A filmmaker · France/);
});

test('stills and posters have distinct visible and accessible labels', () => {
  assert.equal(artworkLabel(art()), 'Film poster');
  assert.equal(artworkLabel(art({ artwork_type: 'PRODUCTION_PHOTOGRAPH' })), 'Production photograph');
  assert.equal(artworkLabel(art({ artwork_type: 'STILL' })), 'Film still');
  assert.match(posterMarkup(film('a', { artwork: art({ artwork_type: 'STILL', alt: '' }) })), /alt="Film still for Film a"/);
});

test('24 distinct API works remain disjoint across all five homepage sections', () => {
  let id = 0;
  const data = programme(Object.fromEntries(PROGRAMME_SECTIONS.map((key, index) => [key, Array.from({ length: [4, 4, 8, 4, 4][index] }, () => film(String(++id), { watchable: key === 'watch' }))])));
  const actual = disjointProgramme(data);
  assert.deepEqual(PROGRAMME_SECTIONS.map((key) => actual[key].length), [4, 4, 8, 4, 4]);
  assert.equal(new Set(PROGRAMME_SECTIONS.flatMap((key) => actual[key].map((item) => item.id))).size, 24);
  assert.equal(actual.seed, 'today');
});

test('duplicate and invalid works never get replaced by invented fallback films', () => {
  const data = programme({ carousel: [film('a'), film('a')], history: [film('a'), film('b')], featured: [film('b'), film('c')], watch: [film('c', { watchable: true }), film('d'), film('e', { embedded: true })], collection: [film('e'), film('f')] });
  const actual = disjointProgramme(data);
  assert.deepEqual(PROGRAMME_SECTIONS.map((key) => actual[key].map((item) => item.id)), [['a'], ['b'], ['c'], ['e'], ['f']]);
  assert.deepEqual(disjointProgramme(programme()).carousel, []);
  assert.throws(() => disjointProgramme({ carousel: [] }), /incomplete/);
});

test('history chapters describe only the selected work, including unresolved metadata', () => {
  const chapters = createCinemaHistoryChapters([film('unexpected', { title: 'A 1970s film', year: 1974 })]);
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].id, 'unexpected');
  assert.equal(chapters[0].title, 'A 1970s film');
  assert.match(chapters[0].text, /1974 · A filmmaker · France/);
  assert.doesNotMatch(JSON.stringify(chapters), /Méliès|moon|new-wave|neorealism|1895/);
  assert.deepEqual(createCinemaHistoryChapters([]), []);
  assert.match(createCinemaHistoryChapters([film('b', { year: null, director: null, countries: [] })])[0].text, /Date unresolved · Filmmaker unresolved · Country unresolved/);
});

test('programme seed stays stable in a session, rotates on a new day and reshuffles explicitly', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  const first = sessionProgrammeSeed(storage, { day: '2026-06-01', random: () => .2 });
  assert.equal(sessionProgrammeSeed(storage, { day: '2026-06-01', random: () => .5 }), first);
  const second = sessionProgrammeSeed(storage, { day: '2026-06-01', random: () => .7, reshuffle: true });
  assert.notEqual(second, first);
  assert.match(sessionProgrammeSeed(storage, { day: '2026-06-02', random: () => .2 }), /^2026-06-02-/);
});

test('storage restrictions never prevent reshuffling', () => {
  const storage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.match(sessionProgrammeSeed(storage, { day: '2026-06-01', reshuffle: true }), /^2026-06-01-/);
});

test('remote verified DOM artwork is never drawn onto a WebGL canvas', () => {
  assert.equal(textureImageUrl('https://remote.example/poster.jpg', 'https://lumetra.example'), '');
  assert.equal(textureImageUrl('/media/artwork/poster.webp', 'https://lumetra.example'), '/media/artwork/poster.webp');
  assert.equal(textureImageUrl('https://lumetra.example/poster.jpg', 'https://lumetra.example'), 'https://lumetra.example/poster.jpg');
  assert.equal(textureImageUrl('//remote.example/poster.jpg', 'https://lumetra.example'), '');
});
