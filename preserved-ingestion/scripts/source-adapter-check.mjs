import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSourceRegistry, getRegisteredP0Adapters, parseAdapterDocument } from '../src/data/source-adapters.js';

const root = resolve(import.meta.dirname, '..');
const registry = createSourceRegistry(JSON.parse(await readFile(resolve(root, 'src/data/source-registry.json'), 'utf8')));
const adapters = getRegisteredP0Adapters(registry);
const p0Ids = new Set(adapters.map((adapter) => adapter.registryId));
for (const adapter of adapters) {
  if (!adapter.urls.length || !adapter.parser) throw new Error(`incomplete adapter: ${adapter.registryId}`);
  if (!registry.get(adapter.registryId)) throw new Error(`adapter has no registry source: ${adapter.registryId}`);
}
const henri = adapters.find((adapter) => adapter.registryId === 'cinematheque_henri');
const fixture = '<ul><li class="film"><a href="film/123-test-director-1960/"><div class=img-container><img alt="Test Film" src="/img/test.jpg"><div class=duree>12:34</div></div><div class=film-info><div class=titre>Test Film</div><div>Test Director, 1960</div></div></a></li></ul>';
const parsed = parseAdapterDocument(henri, fixture, 'https://www.cinematheque.fr/henri/', registry.get('cinematheque_henri'));
if (parsed.length !== 1 || parsed[0].title !== 'Test Film' || parsed[0].year !== 1960 || parsed[0].runtime === null) throw new Error('HENRI parser fixture failed');
console.log(JSON.stringify({ p0_adapters: adapters.length, adapter_ids: [...p0Ids], fixture: parsed[0], status: 'P0 adapter checks passed' }, null, 2));
