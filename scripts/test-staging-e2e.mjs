import assert from 'node:assert/strict';

const baseUrl = process.env.STAGING_URL || 'http://127.0.0.1:4173';
console.log(`Starting Lumetra Staging Verification against: ${baseUrl}`);

async function request(path) {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url);
  return { status: response.status, headers: response.headers, text: await response.text() };
}

async function requestJson(path) {
  const res = await request(path);
  assert.equal(res.status, 200, `Expected 200 OK for ${path}, got ${res.status}`);
  return JSON.parse(res.text);
}

// 1. Verify Shell and Homepage
console.log('Testing Shell & Homepage HTML...');
const home = await request('/');
assert.equal(home.status, 200);
assert(home.text.includes('Lumetra — Everything Cinema'), 'Missing page title in homepage');
assert(home.text.includes('id="site-header"'), 'Missing site header in homepage');
assert(home.text.includes('id="horizon-nav"'), 'Missing mobile horizon nav in shell');
assert(home.text.includes('id="intro"'), 'Missing theater intro section');
assert(home.text.includes('property="og:url"'), 'Missing Open Graph URL metadata');
assert(home.text.includes('id="structured-data"'), 'Missing structured metadata payload');
assert.equal(home.headers.get('x-content-type-options'), 'nosniff', 'Shell must send nosniff protection');
assert.match(home.headers.get('content-security-policy') || '', /default-src 'self'/, 'Shell must send the site CSP');

// Direct reloads must keep the same Lumetra shell. Client routing then selects
// the requested surface; the Worker must never fall through to a placeholder.
console.log('Testing direct route shell consistency...');
for (const path of [
  '/discover', '/watch', '/film/work-trip-to-the-moon',
  '/person/Georges%20M%C3%A9li%C3%A8s', '/world', '/journal',
  '/essay/many-beginnings', '/essay/sound-was-not-a-switch', '/my-cinema', '/museum', '/about', '/corrections',
]) {
  const route = await request(path);
  assert.equal(route.status, 200, `Expected shell for ${path}`);
  assert(route.text.includes('id="site-header"'), `Missing header shell for ${path}`);
  assert(route.text.includes('id="intro"'), `Missing cinematic intro shell for ${path}`);
}

// 2. Verify Catalogue Statistics & Exact Film Count
console.log('Testing Catalogue Stats (/api/stats)...');
const stats = await requestJson('/api/stats');
console.log(`Verified Catalogue counts: ${stats.works} works, ${stats.eligible_sources} eligible sources`);
assert.equal(stats.works, 20512, 'Catalogue count must be exactly 20,512 films');
assert.equal(stats.ready, true, 'Catalogue must report ready: true');
assert.equal(stats.artwork_ready, true, 'Artwork pipeline must report ready: true');

// 3. Verify FTS5 Search & Query Engine
console.log('Testing Full-Text Search (/api/films?q=Moon)...');
const search = await requestJson('/api/films?q=Moon');
assert(search.total >= 27, `Expected at least 27 search results for 'Moon', got ${search.total}`);
assert(search.items.length > 0, 'Search should return items array');
const topFilm = search.items[0];
console.log(`Top search hit: ${topFilm.title} (${topFilm.year})`);

console.log('Testing verified playback and artwork filters...');
const watch = await requestJson('/api/films?watch=1');
if (stats.eligible_sources === 0) {
  assert.equal(watch.total, 0, 'Expired verification must not produce watchable results');
  console.warn('RELEASE BLOCKER: no current verified viewing links; refresh source evidence before public watch launch');
} else {
  assert(watch.items.length > 0, 'Verified viewing filter must include currently eligible items');
}
assert(watch.items.every((film) => film.watchable || film.embedded), 'Viewing results must have an eligible playback state');
const artworkOnly = await requestJson('/api/films?artwork=1');
assert.equal(artworkOnly.total, stats.approved_artwork, 'Artwork filter must match approved artwork count');
assert(artworkOnly.items.every((film) => film.artwork), 'Artwork results must carry verified provenance');

// 4. Verify Multi-Attribute Filtering (FTS5 + Country + Year)
console.log('Testing Multi-Attribute Filter (/api/films?q=moon&country=France&year=1902)...');
const filtered = await requestJson('/api/films?q=moon&country=France&year=1902');
assert.equal(filtered.total, 1, 'Multi-attribute filter must resolve to exactly 1 record');
assert.equal(filtered.items[0].id, 'work-trip-to-the-moon', 'Filtered result must be Le Voyage dans la Lune');

// 5. Verify Film Detail & Dossier
console.log('Testing Film Detail Dossier (/api/films/work-trip-to-the-moon)...');
const dossier = await requestJson('/api/films/work-trip-to-the-moon');
assert.equal(dossier.title, 'Le Voyage dans la Lune');
assert.equal(dossier.director, 'Georges Méliès');
assert.equal(dossier.year, 1902);
assert(Array.isArray(dossier.evidence) && dossier.evidence.length > 0, 'Film must have evidence trail');
assert(dossier.artwork, 'Film must contain verified artwork');
assert(dossier.sources.every((source) => /^https:\/\//.test(source.canonical_source_url)), 'Playback evidence must use HTTPS source URLs');

// 6. Verify Dynamic Programming & Living Universe
console.log('Testing Programming Dimensions (/api/programming)...');
const prog = await requestJson('/api/programming');
assert(Array.isArray(prog.featured) && prog.featured.length > 0, 'Featured section must contain films');
assert(Array.isArray(prog.history) && prog.history.length > 0, 'History timeline must contain films');
assert(Array.isArray(prog.carousel) && prog.carousel.length > 0, 'Carousel must contain films');

// 7. Verify Facets & Filter Dimensions
console.log('Testing Facets (/api/facets)...');
const facets = await requestJson('/api/facets');
assert(Array.isArray(facets.countries) && facets.countries.length >= 100, 'Must have at least 100 countries in facets');
assert(Array.isArray(facets.years) && facets.years.includes(1902), 'Years must include 1902');

// 8. Verify Verified Artwork Media Serving
console.log('Testing Artwork Serving (/media/artwork/2552e27ef4d4a0c10c56a851-320.webp)...');
const artwork = await request('/media/artwork/2552e27ef4d4a0c10c56a851-320.webp');
assert.equal(artwork.status, 200);
assert.equal(artwork.headers.get('content-type'), 'image/webp');

console.log('Staging functional verification PASSED. Public-release requirements are assessed separately.');
