import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = ['src/index.html', 'src/styles.css', 'src/app.js', 'src/data/catalogue.js', 'src/data/source-model.js', 'src/data/source-registry.json'];
for (const file of files) {
  const value = await readFile(resolve(root, file), 'utf8');
  if (!value.trim()) throw new Error(`${file} is empty`);
  console.log(`ok ${file} (${value.length} bytes)`);
}
const app = await readFile(resolve(root, 'src/app.js'), 'utf8');
const data = await readFile(resolve(root, 'src/data/catalogue.js'), 'utf8');
const sourceModel = await readFile(resolve(root, 'src/data/source-model.js'), 'utf8');
const sourceRegistry = await readFile(resolve(root, 'src/data/source-registry.json'), 'utf8');
for (const needle of ['Watchable First', 'NO VERIFIED STREAMING SOURCE', 'report-source', 'filter']) {
  if (!app.includes(needle) && !data.includes(needle)) throw new Error(`missing behavior marker: ${needle}`);
}
for (const needle of ['SourceRegistry', 'PlaybackSource', 'deriveWatchState', 'full_film_verified', 'official_or_rights_verified']) {
  if (!sourceModel.includes(needle) && !sourceRegistry.includes(needle)) throw new Error(`missing source-ingestion marker: ${needle}`);
}
console.log('Global Cinema structural checks passed');
