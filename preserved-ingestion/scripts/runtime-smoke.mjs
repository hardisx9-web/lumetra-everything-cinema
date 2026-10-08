import { ingestedFilms } from '../src/data/ingested-catalogue.js';
import { films } from '../src/data/catalogue.js';
import { deriveWatchState, WATCH_STATES } from '../src/data/source-model.js';

const listeners = new Map();
const windowListeners = new Map();
const elements = new Map();

function mockElement() {
  return {
    hidden: false,
    value: '',
    innerHTML: '',
    open: false,
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener(type, handler) { listeners.set(`${type}:${Math.random()}`, handler); },
    setAttribute() {},
    getAttribute() { return null; },
    focus() {},
    showModal() { this.open = true; },
    close() { this.open = false; },
  };
}

for (const selector of ['#app', '#site-nav', '#search-drawer', '#global-search', '#source-dialog', '#dialog-content']) elements.set(selector, mockElement());
const app = elements.get('#app');
const documentMock = {
  title: '',
  querySelector(selector) { return elements.get(selector) || null; },
  querySelectorAll() { return []; },
  addEventListener(type, handler) { listeners.set(type, handler); },
};
const windowMock = {
  innerWidth: 1024,
  addEventListener(type, handler) { windowListeners.set(type, handler); },
};
globalThis.document = documentMock;
globalThis.window = windowMock;
globalThis.location = { hash: '' };

await import(`../src/app.js?runtime=${Date.now()}`);
const onHashChange = windowListeners.get('hashchange');
if (!onHashChange) throw new Error('hashchange listener was not registered');

const routes = [
  '#home',
  '#watch',
  '#explore?watchable=1',
  '#theater',
  '#cinema',
  '#cinema/history',
  '#journal',
  '#world/Africa',
  '#movements',
  '#people',
  '#person/georges-melies',
  '#recognition',
  '#about',
  '#collections',
  '#collection/watch-tonight',
  '#lost',
  '#method',
  '#film/work-tokyo-story',
  '#film/work-london-after-midnight',
  '#does-not-exist',
];
const snapshots = [];
for (const hash of routes) {
  globalThis.location.hash = hash;
  onHashChange();
  if (!app.innerHTML || app.innerHTML.length < 80) throw new Error(`route rendered empty output: ${hash}`);
  const heading = app.innerHTML.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || 'no h1';
  snapshots.push({ route: hash, bytes: app.innerHTML.length, heading });
}
globalThis.location.hash = '#home';
onHashChange();
if (!app.innerHTML.includes('ARCHIVAL FALLBACK')) throw new Error('poster fallback did not render on a card');
const clickHandler = listeners.get('click');
const currentFilm = [...films,...ingestedFilms].find((film) => film.availability.sources.some((source) => source.verifier === 'provider-health-check' && deriveWatchState(source) !== WATCH_STATES.NO_VERIFIED_FREE_STREAM));
const sourceButton = { dataset: { action: 'open-source', film: currentFilm?.id || 'work-trip-to-the-moon' }, closest(selector) { return selector === '[data-route]' ? null : this; } };
clickHandler({ target: sourceButton });
const dialogHtml = elements.get('#dialog-content').innerHTML;
if (currentFilm && !/Watch externally|Load permitted player/u.test(dialogHtml)) throw new Error('verified Cinema Player source path did not render');
if (!currentFilm && (!dialogHtml.includes('No current independently verified') || /Watch externally|<iframe/u.test(dialogHtml))) throw new Error('unverified source exposed a player/watch action');
// Check the published Work routes too, not only the fixed editorial seed routes.
for (const film of ingestedFilms) { globalThis.location.hash = `#film/${film.id}`; onHashChange(); if (!app.innerHTML.includes('Film record /')) throw new Error(`database Work route did not render: ${film.id}`); }
console.log(JSON.stringify({ routes: routes.length, snapshots, databaseWorkRoutes: ingestedFilms.length, playerShell: currentFilm ? 'verified source path passed' : 'no-source fail-closed path passed', posterFallback: 'passed', status: 'runtime route smoke passed' }, null, 2));
