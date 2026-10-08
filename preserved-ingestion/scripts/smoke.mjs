import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { collections, films, movements, navigation, recognitionRecords, researchDate } from '../src/data/catalogue.js';
import { ingestedFilms } from '../src/data/ingested-catalogue.js';
import { deriveWatchState, WATCH_STATES } from '../src/data/source-model.js';

const root = resolve(import.meta.dirname, '..');
const requiredAppMarkers = [
  'renderWatch',
  'renderExplore',
  'renderCinema',
  'renderJournal',
  'renderFilm',
  'renderPeople',
  'renderRecognition',
  'renderMethod',
  'Watchable First',
  'report-source',
  'NO VERIFIED STREAMING SOURCE',
  'Cinema Player / source selection',
  'playerAdapterFor',
  'availabilityPriority',
];
const app = await readFile(resolve(root, 'src/app.js'), 'utf8');
const html = await readFile(resolve(root, 'src/index.html'), 'utf8');
const styles = await readFile(resolve(root, 'src/styles.css'), 'utf8');
const data = await readFile(resolve(root, 'src/data/catalogue.js'), 'utf8');
if (!data.includes('playerAdapters') || !app.includes('art-fallback-label')) throw new Error('phase 0 player/poster architecture markers missing');
if (!styles.includes('background: var(--ink)') || !styles.includes('.primary-doors')) throw new Error('black-first visual system markers missing');
for (const marker of requiredAppMarkers) {
  if (!app.includes(marker)) throw new Error(`missing app behavior: ${marker}`);
}
for (const route of ['watch', 'explore', 'theater', 'cinema', 'journal', 'people', 'recognition', 'lost', 'method']) {
  if (!html.includes(`data-route="${route}"`)) throw new Error(`missing navigation route: ${route}`);
}

const allFilms = [...films, ...ingestedFilms];
const ids = new Set(allFilms.map((film) => film.id));
if (ids.size !== allFilms.length) throw new Error('duplicate Work IDs');
const allowedModes = new Set(['ARCHIVE_VIEWING_ONLY', 'NONE_KNOWN', 'STREAM_FREE_EXTERNAL', 'STREAM_FREE_EMBED']);
for (const film of allFilms) {
  if (!film.id || !film.displayTitle || !film.originalTitle || !film.director || !film.year) throw new Error(`incomplete identity: ${film.id}`);
  if (!film.availability?.lastVerified) throw new Error(`missing availability date: ${film.id}`);
  if (!allowedModes.has(film.availability.mode)) throw new Error(`unreviewed availability mode: ${film.id}`);
  const publicSources = (film.availability.sources || []).filter((source) => source.watch_state === 'WATCH_HERE' || source.watch_state === 'WATCH_FREE_EXTERNALLY');
  if (film.availability.mode === 'NONE_KNOWN' && publicSources.length) throw new Error(`unavailable Work has public playback source: ${film.id}`);
  for (const source of publicSources) if (source.last_checked_at && source.lastVerified !== source.last_checked_at) throw new Error(`source verification timestamp mismatch: ${film.id}`);
  if (['LOST', 'PARTIALLY_LOST', 'FRAGMENT_SURVIVES'].includes(film.existenceStatus) && publicSources.length) throw new Error(`lost Work has playback source: ${film.id}`);
  for (const source of film.availability.sources || []) {
    if ((source.watch_state === 'WATCH_HERE' || source.watch_state === 'WATCH_FREE_EXTERNALLY') && !(source.full_film_verified && source.free_verified && source.official_or_rights_verified && source.live_check_status === 'PASS')) throw new Error(`source bypasses hard gate: ${film.id}`);
  }
  for (const source of film.sources) if (!source.url || !source.label || !source.tier) throw new Error(`incomplete citation: ${film.id}`);
}
for (const collection of collections) for (const id of collection.filmIds) if (!ids.has(id)) throw new Error(`orphan collection item: ${id}`);
for (const record of recognitionRecords) if (!ids.has(record.filmId) || !record.source) throw new Error(`orphan recognition record: ${record.id}`);
if (movements.length < 5) throw new Error('movement index is too small');
for (const item of navigation) if (!item.label || !item.route) throw new Error('incomplete navigation item');

const watchablePriority = (film) => ((film.availability?.sources || []).some((source) => source.verifier === 'provider-health-check' && deriveWatchState(source) !== WATCH_STATES.NO_VERIFIED_FREE_STREAM) ? 1 : 0);
const oldestWithWatchableFirst = [...allFilms].sort((a, b) => watchablePriority(b) - watchablePriority(a) || a.year - b.year);
if (allFilms.some(watchablePriority) && !watchablePriority(oldestWithWatchableFirst[0])) throw new Error('Watchable First does not precede unavailable records');
if (!oldestWithWatchableFirst.some((film) => !watchablePriority(film))) throw new Error('Watchable First hides unavailable records');
const pather = allFilms.find((film) => film.alternateTitles?.includes('Song of the Little Road'));
if (!pather) throw new Error('alternate-title search fixture missing');
if (!allFilms.some((film) => film.historicalCountries?.includes('Ukrainian SSR'))) throw new Error('historical geography fixture missing');

for (const output of ['dist/index.html', 'dist/styles.css', 'dist/app.js', 'dist/data/catalogue.js']) await access(resolve(root, output));
console.log(JSON.stringify({
  works: allFilms.length,
  seedWorks: films.length,
  ingestedWorks: ingestedFilms.length,
  sourceBacked: allFilms.filter(watchablePriority).length,
  collections: collections.length,
  movements: movements.length,
  recognitionRecords: recognitionRecords.length,
  researchDate,
  status: 'smoke checks passed',
}, null, 2));
