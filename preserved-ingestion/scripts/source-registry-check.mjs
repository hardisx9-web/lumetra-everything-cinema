import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SourceRegistry, validatePlaybackSource, WATCH_STATES } from '../src/data/source-model.js';

const root = resolve(import.meta.dirname, '..');
const registryJson = JSON.parse(await readFile(resolve(root, 'src/data/source-registry.json'), 'utf8'));
const registry = new SourceRegistry(registryJson);
const registryResult = registry.validate();
if (!registryResult.valid) throw new Error(registryResult.errors.join('; '));
if (registry.p0().length < 10) throw new Error(`expected the registered P0 source set, found ${registry.p0().length}`);

const completeUnverified = validatePlaybackSource({
  source_id: 'source_test_unverified',
  source_owner: 'Test owner',
  canonical_source_url: 'https://example.com/watch',
  film_id: 'work-test',
  full_film_verified: true,
  free_verified: true,
  official_or_rights_verified: true,
  embed_status: 'EXTERNAL_ONLY',
  external_watch_url: 'https://example.com/watch',
  territories: ['worldwide'],
  audio_languages: ['English'],
  subtitle_languages: [],
  version_or_restoration: 'Unknown',
  runtime: 90,
  first_verified_at: new Date().toISOString(),
  last_checked_at: new Date().toISOString(),
  verification_evidence: ['test fixture'],
  availability_expiry_if_known: null,
  live_check_status: 'PENDING',
});
if (completeUnverified.publishable || completeUnverified.watch_state !== WATCH_STATES.NO_VERIFIED_FREE_STREAM) throw new Error('hard gate allowed an unlive source');

const externalVerified = validatePlaybackSource({
  source_id: 'source_test_external',
  source_owner: 'Test owner',
  canonical_source_url: 'https://example.com/watch',
  film_id: 'work-test',
  full_film_verified: true,
  free_verified: true,
  official_or_rights_verified: true,
  embed_status: 'UNKNOWN',
  external_watch_url: 'https://example.com/watch',
  territories: ['worldwide'],
  audio_languages: ['English'],
  subtitle_languages: [],
  version_or_restoration: 'Unknown',
  runtime: 90,
  first_verified_at: new Date().toISOString(),
  last_checked_at: new Date().toISOString(),
  verification_evidence: ['official listing', 'live full-film check'],
  availability_expiry_if_known: null,
  live_check_status: 'PASS',
});
if (!externalVerified.publishable || externalVerified.watch_state !== WATCH_STATES.WATCH_FREE_EXTERNALLY) throw new Error('verified external source did not become external-watchable');

const internalVerified = validatePlaybackSource({
  ...externalVerified.source,
  source_id: 'source_test_internal',
  embed_working: true,
  embed_status: 'PERMITTED',
  embed_url_if_allowed: 'https://example.com/embed/work-test',
});
if (!internalVerified.publishable || internalVerified.watch_state !== WATCH_STATES.WATCH_HERE) throw new Error('permitted verified embed did not become WATCH_HERE');

console.log(JSON.stringify({
  registry: registryResult,
  p0_sources: registry.p0().map((source) => source.id),
  hard_gate_fixtures: {
    pending: completeUnverified.watch_state,
    external: externalVerified.watch_state,
    internal: internalVerified.watch_state,
  },
  status: 'source registry model checks passed',
}, null, 2));
