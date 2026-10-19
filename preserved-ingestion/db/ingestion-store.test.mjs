import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { createRun, persistEnumeration, persistVerification, finishSource, finishRun, stableSourceId } from './ingestion-store.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for isolated real PostgreSQL tests');
const adminUrl = new URL(process.env.DATABASE_URL); adminUrl.pathname = '/postgres';
const database = `gc_ingestion_store_test_${process.pid}`;
const testUrl = new URL(process.env.DATABASE_URL); testUrl.pathname = `/${database}`;
const admin = new pg.Client({ connectionString: adminUrl.href });
const client = new pg.Client({ connectionString: testUrl.href });
const observer = new pg.Client({ connectionString: testUrl.href });
const a = { id: 'fixture_a', name: 'Fixture Archive A', official_url: 'https://archive-a.example/', status: 'APPROVED', free: true };
const b = { id: 'fixture_b', name: 'Fixture Archive B', official_url: 'https://archive-b.example/', status: 'APPROVED', free: true };
const c = { id: 'fixture_c', name: 'Fixture Archive C', official_url: 'https://archive-c.example/', status: 'APPROVED', free: true };
const registry = (...sources) => ({ registry_meta: { version: 'store-fixture-v1' }, sources });
const candidate = (key, source = a, extra = {}) => ({ registry_source_id: source.id, title: `Film ${key}`, display_title: `Film ${key}`, original_title: `Film ${key}`, alternate_titles: [], countries: ['FR'], director_credit: 'René Åki', year: 1960, runtime: 90, source_url: `${source.official_url}film/${key}`, external_id: key, external_identifiers: {}, poster_url: `${source.official_url}image/${key}.jpg`, parser: `fixture:${source.id}`, raw: { key }, ...extra });
const enumeration = (candidates, extra = {}) => ({ candidates, status: 'ENUMERATED', enumeration_complete: true, requests: [{ url: 'https://archive-a.example/catalogue', status: 200, bytes: 10, sha256: 'redacted-fixture' }], ...extra });
const record = (item, extra = {}) => ({ source_id: stableSourceId(item.registry_source_id, item.source_url), registry_source_id: item.registry_source_id, source_owner: 'Fixture Archive', canonical_source_url: item.source_url, full_film_verified: true, free_verified: true, official_or_rights_verified: true, embed_status: 'PROHIBITED', embed_working: false, embed_url_if_allowed: null, external_watch_url: item.source_url, territories: ['WORLDWIDE'], audio_languages: ['fr'], subtitle_languages: ['en'], version_or_restoration: 'Official restoration', runtime: item.runtime, first_verified_at: new Date(Date.now() - 5000).toISOString(), last_checked_at: new Date(Date.now() - 1000).toISOString(), verification_evidence: [{ kind: 'LIVE_SOURCE', method: 'fixture official VOD manifest check', url: item.source_url, value: { vod_endlist: true, duration_minutes: 90, duration_matches: true } }, { kind: 'RIGHTS', method: 'fixture official provider terms', url: item.source_url, value: { free: true, complete_film: true, official: true } }], availability_expiry_if_known: null, live_check_status: 'PASS', lifecycle_status: 'VERIFIED', watch_state: 'WATCH_FREE_EXTERNALLY', adapter_id: item.parser, metadata: { detail_checked: true }, ...extra });
const row = async (sql, values = [], connection = client) => (await connection.query(sql, values)).rows[0];
const count = async (table, where = '', values = []) => Number((await row(`SELECT COUNT(*) AS n FROM ${table} ${where}`, values)).n);
const publicCount = (id) => count('public_watchable_sources', 'WHERE source_id=$1', [id]);
const stage = async (item, source = a, mode) => {
  const runId = await createRun(client, { registry: registry(source), ...(mode ? { mode } : {}) });
  await persistEnumeration(client, runId, source, enumeration([item]));
  return runId;
};
const assertCode = (promise, code) => assert.rejects(promise, (error) => error.code === code);
let historicalRunId;
const oldReport = { immutable: true, source_results: [{ status: 'OLD', records: [] }] };
try {
  await admin.connect(); await admin.query(`CREATE DATABASE ${database}`);
  await client.connect(); await observer.connect();
  await test('004 is additive, rerunnable, and does not rewrite reports or the public seven-day proof view', async () => {
    for (const file of ['001_source_registry.sql', '002_verification_safety.sql', '003_evidence_provenance.sql']) await client.query(await readFile(resolve(import.meta.dirname, 'migrations', file), 'utf8'));
    historicalRunId = (await row(`INSERT INTO ingest_run (mode,started_at,finished_at,status,report_json,counts) VALUES ('VERIFY_DETAILS',NOW(),NOW(),'HISTORICAL_IMPORT',$1::jsonb,'{"historical":1}'::jsonb) RETURNING run_id`, [JSON.stringify(oldReport)])).run_id;
    const view = (await row("SELECT pg_get_viewdef('public_watchable_sources'::regclass) AS definition")).definition;
    const sql = await readFile(resolve(import.meta.dirname, 'migrations', '004_resumable_ingestion.sql'), 'utf8');
    await client.query(sql); await client.query(sql);
    assert.equal((await row("SELECT pg_get_viewdef('public_watchable_sources'::regclass) AS definition")).definition, view);
    assert.deepEqual((await row('SELECT report_json FROM ingest_run WHERE run_id=$1', [historicalRunId])).report_json, oldReport);
    assert.equal(await count('source_verification'), 0);
    await assertCode(finishRun(client, historicalRunId, {}), 'INGESTION_STATE');
  });
  await test('enumeration commits all candidates, review states, blockers and requests before any details', async () => {
    const runId = await createRun(client, { registry: registry(a, b) });
    const full = candidate('enum-full');
    const missing = candidate('enum-missing', a, { year: null, director_credit: null });
    const invalid = candidate('enum-invalid', a, { year: 'unknown' });
    const result = enumeration([full, missing, invalid], { pages: 2, advertised_total: 3 });
    assert.equal((await persistEnumeration(client, runId, a, result)).candidates, 3);
    const snapshots = (await observer.query('SELECT * FROM ingest_candidate WHERE ingest_run_id=$1 ORDER BY title', [runId])).rows;
    assert.equal(snapshots.length, 3, 'a separate connection sees the committed enumeration before verification');
    assert.equal(snapshots.filter((item) => item.work_id).length, 1);
    assert.equal(snapshots.filter((item) => item.candidate_status === 'REVIEW').length, 2);
    assert.deepEqual(snapshots.find((item) => item.title === full.title).candidate_json, full);
    assert.equal(await count('source_verification', 'WHERE ingest_run_id=$1', [runId]), 0);
    assert.equal(await count('playback_source'), 0);
    assert.equal(await count('media_asset', 'WHERE canonical_url=$1', [full.poster_url]), 1);
    assert.equal(await count('media_asset', 'WHERE canonical_url=$1', [missing.poster_url]), 0);
    const blocked = enumeration([], { status: 'SOURCE_ACCESS_BLOCKED', enumeration_complete: false, blocker: 'HTTP 403; no bypass attempted', requests: [{ url: b.official_url, status: 403 }] });
    await persistEnumeration(client, runId, b, blocked);
    const saved = await row('SELECT * FROM ingest_source_result WHERE ingest_run_id=$1 AND registry_source_id=$2', [runId, b.id]);
    assert.equal(saved.enumeration_complete, false); assert.equal(saved.enumeration_status, 'SOURCE_ACCESS_BLOCKED');
    assert.equal(saved.blocker, blocked.blocker); assert.deepEqual(saved.requests, blocked.requests); assert.deepEqual(saved.result_json, blocked);
    assert.equal((await persistEnumeration(client, runId, a, result)).skipped, true);
    await assertCode(persistEnumeration(client, runId, a, { ...result, pages: 3 }), 'INGESTION_CONFLICT');
    assert.equal((await finishSource(client, runId, b.id, { blocker: blocked.blocker })).status, 'SOURCE_ACCESS_BLOCKED');
    await assertCode(finishSource(client, runId, a.id, { status: 'COMPLETED' }), 'INGESTION_STATE');
    assert.equal((await finishSource(client, runId, a.id, {})).status, 'PARTIAL');
    const finished = await finishRun(client, runId, {});
    assert.equal(finished.status, 'PARTIAL'); assert.equal(finished.counts.candidates, 3); assert.equal(finished.counts.reviews, 2);
  });
  await test('fresh evidence is run-associated, immutable/idempotent, publicly gated, and resumable from a different client', async () => {
    const item = candidate('verified-resume');
    const runId = await createRun(client, { registry: registry(a) });
    const proof = record(item);
    await assertCode(persistVerification(client, runId, a, item, proof), 'INGESTION_STATE');
    await persistEnumeration(client, runId, a, enumeration([item]));
    const verified = await persistVerification(observer, runId, a, item, proof);
    assert.ok(verified.workId); assert.equal(verified.currentUpdated, true);
    const saved = await row('SELECT * FROM source_verification WHERE verification_id=$1', [verified.verificationId]);
    assert.equal(saved.ingest_run_id, runId); assert.equal(saved.candidate_id, verified.candidateId); assert.equal(saved.verifier, 'provider-health-check');
    assert.deepEqual(saved.evidence, proof.verification_evidence);
    assert.equal(saved.record_json.metadata.title, item.title); assert.equal(saved.record_json.metadata.detail_checked, true);
    await assertCode(client.query("UPDATE source_verification SET evidence='[]'::jsonb WHERE verification_id=$1", [verified.verificationId]), '55000');
    await assertCode(client.query('DELETE FROM source_verification WHERE verification_id=$1', [verified.verificationId]), '55000');
    await assertCode(client.query("UPDATE ingest_candidate SET candidate_json='{}'::jsonb WHERE candidate_id=$1", [verified.candidateId]), '55000');
    assert.equal(await publicCount(verified.sourceId), 1);
    assert.equal((await row('SELECT license_verified FROM media_asset WHERE canonical_url=$1', [item.poster_url])).license_verified, false);
    assert.equal((await persistVerification(client, runId, a, item, proof)).skipped, true);
    assert.equal(await count('source_verification', 'WHERE ingest_run_id=$1', [runId]), 1);
    await assertCode(persistVerification(client, runId, a, item, { ...proof, free_verified: false }), 'INGESTION_CONFLICT');
    await assertCode(persistVerification(client, runId, a, { ...item, title: 'Changed' }, proof), 'INGESTION_CONFLICT');
    await assertCode(persistVerification(client, runId, a, item, { ...proof, canonical_source_url: `${a.official_url}other` }), 'INGESTION_INPUT');
    const sourceSummary = { status: 'COMPLETED', checked: 1 };
    const runSummary = { status: 'COMPLETED', note: 'all sources completed' };
    assert.equal((await finishSource(client, runId, a.id, sourceSummary)).status, 'COMPLETED');
    assert.equal((await finishRun(client, runId, runSummary)).status, 'COMPLETED');
    assert.equal((await finishSource(client, runId, a.id, sourceSummary)).skipped, true);
    assert.equal((await finishRun(client, runId, runSummary)).skipped, true);
    assert.equal((await persistEnumeration(client, runId, a, enumeration([item]))).skipped, true);
    assert.equal((await persistVerification(client, runId, a, item, proof)).skipped, true);
    await assertCode(finishSource(client, runId, a.id, { checked: 2 }), 'INGESTION_CONFLICT');
    await assertCode(finishRun(client, runId, { status: 'FAILED' }), 'INGESTION_CONFLICT');
    assert.deepEqual((await row('SELECT report_json FROM ingest_run WHERE run_id=$1', [historicalRunId])).report_json, oldReport);
  });
  await test('verification enrichment resolves a reviewed candidate without rewriting its enumeration snapshot', async () => {
    const item = candidate('enriched', a, { year: null, director_credit: null });
    const runId = await stage(item);
    const staged = await row('SELECT * FROM ingest_candidate WHERE ingest_run_id=$1', [runId]);
    assert.equal(staged.work_id, null); assert.match(staged.match_review, /missing/);
    assert.equal(await count('media_asset', 'WHERE canonical_url=$1', [item.poster_url]), 0);
    const proof = record(item, { full_film_verified: false, live_check_status: 'PENDING', lifecycle_status: 'REVIEW', watch_state: 'NO_VERIFIED_FREE_STREAM', metadata: { year: 1960, director_credit: 'René Åki', detail_checked: true } });
    const saved = await persistVerification(client, runId, a, item, proof);
    assert.ok(saved.workId, 'nonverified candidates still resolve canonical identity');
    const candidateRow = await row('SELECT * FROM ingest_candidate WHERE ingest_run_id=$1', [runId]);
    assert.deepEqual(candidateRow.candidate_json, item); assert.equal(candidateRow.match_review, null); assert.equal(candidateRow.work_id, saved.workId);
    assert.equal(await count('media_asset', 'WHERE canonical_url=$1', [item.poster_url]), 1);
    assert.equal(await publicCount(saved.sourceId), 0);
    assert.equal(await count('work_resolution_event', 'WHERE candidate_id=$1', [staged.candidate_id]), 2);
  });
  await test('validated BFI native identity creates sparse provisional works and reuses only its source-scoped ID', async () => {
    const bfi = { id: 'bfi_player_free', name: 'BFI', official_url: 'https://player.bfi.org.uk/' };
    const sparse = (nid, extra = {}) => candidate(`native-${nid}`, bfi, { title: 'A Bedtime Story', display_title: 'A Bedtime Story', original_title: 'A Bedtime Story', year: 1959, director_credit: null, external_id: nid, external_identifiers: { bfi_nid: nid }, poster_url: null, ...extra });
    const item = sparse('12122');
    const firstRun = await stage(item, bfi);
    const first = await row('SELECT * FROM ingest_candidate WHERE ingest_run_id=$1', [firstRun]);
    assert.ok(first.work_id); assert.equal(first.match_review, null);
    const work = await row('SELECT * FROM work WHERE work_id=$1', [first.work_id]);
    assert.equal(work.verification_level, 'PROVISIONAL'); assert.equal(work.year, 1959); assert.equal(work.director, null);
    assert.equal(work.stable_key, 'identifier:registry:bfi_player_free:bfi_nid:12122');
    assert.equal((await row("SELECT work_id FROM work_identifier WHERE namespace='registry:bfi_player_free:bfi_nid' AND external_id='12122'")).work_id, first.work_id);
    const nextRun = await stage(sparse('12122', { source_url: `${bfi.official_url}film/new-slug` }), bfi);
    assert.equal((await row('SELECT work_id FROM ingest_candidate WHERE ingest_run_id=$1', [nextRun])).work_id, first.work_id);
    const twinRun = await stage(sparse('12123'), bfi);
    assert.notEqual((await row('SELECT work_id FROM ingest_candidate WHERE ingest_run_id=$1', [twinRun])).work_id, first.work_id);
    const noYearRun = await stage(sparse('12124', { year: null }), bfi);
    assert.ok((await row('SELECT work_id FROM ingest_candidate WHERE ingest_run_id=$1', [noYearRun])).work_id);
    const other = candidate('native-other-provider', b, { title: item.title, display_title: item.title, original_title: item.title, year: 1959, director_credit: null, external_id: '12122', external_identifiers: { bfi_nid: '12122' } });
    const otherRun = await stage(other, b);
    assert.equal((await row('SELECT work_id FROM ingest_candidate WHERE ingest_run_id=$1', [otherRun])).work_id, null);
    const fullOther = await stage({ ...other, director_credit: 'Independent Director' }, b);
    assert.notEqual((await row('SELECT work_id FROM ingest_candidate WHERE ingest_run_id=$1', [fullOther])).work_id, first.work_id);
  });
  await test('concurrent source-scoped native observations create only one sparse work and identifier binding', async () => {
    const bfi = { id: 'bfi_player_free', name: 'BFI', official_url: 'https://player.bfi.org.uk/' };
    const item = candidate('native-concurrent', bfi, { year: null, director_credit: null, external_id: '12940', external_identifiers: { bfi_nid: '12940' } });
    const firstRun = await createRun(client, { registry: registry(bfi) });
    const secondRun = await createRun(observer, { registry: registry(bfi) });
    await Promise.all([persistEnumeration(client, firstRun, bfi, enumeration([item])), persistEnumeration(observer, secondRun, bfi, enumeration([{ ...item, source_url: `${bfi.official_url}film/native-concurrent-alias` }]))]);
    const rows = (await client.query('SELECT work_id FROM ingest_candidate WHERE ingest_run_id=ANY($1::uuid[])', [[firstRun, secondRun]])).rows;
    assert.ok(rows[0].work_id); assert.equal(rows[0].work_id, rows[1].work_id);
    assert.equal(await count('work_identifier', "WHERE namespace='registry:bfi_player_free:bfi_nid' AND external_id='12940'"), 1);
    assert.equal(await count('work', "WHERE stable_key='identifier:registry:bfi_player_free:bfi_nid:12940'"), 1);
  });
  await test('native re-observation preserves metadata-verified aliases but never sparse shared-only cross-provider joins', async () => {
    const bfi = { id: 'bfi_player_free', name: 'BFI', official_url: 'https://player.bfi.org.uk/' };
    const full = candidate('native-full-1', bfi, { title: 'Native Metadata Alias', display_title: 'Native Metadata Alias', original_title: 'Native Metadata Alias', external_id: '12930', external_identifiers: { bfi_nid: '12930' } });
    const firstRun = await stage(full, bfi);
    const firstId = (await row('SELECT work_id FROM ingest_candidate WHERE ingest_run_id=$1', [firstRun])).work_id;
    const alias = { ...full, source_url: `${bfi.official_url}film/native-full-2`, external_id: '12931', external_identifiers: { bfi_nid: '12931' } };
    const aliasRun = await stage(alias, bfi);
    assert.equal((await row('SELECT work_id FROM ingest_candidate WHERE ingest_run_id=$1', [aliasRun])).work_id, firstId, 'normal title/year/director matching remains available');
    const sparseRun = await stage({ ...full, director_credit: null }, bfi);
    assert.equal((await row('SELECT work_id FROM ingest_candidate WHERE ingest_run_id=$1', [sparseRun])).work_id, firstId, 'an already-bound native ID is not a new conflicting alias');
    const directorConflictRun = await stage({ ...full, director_credit: 'Contradictory Director' }, bfi);
    assert.equal((await row('SELECT work_id FROM ingest_candidate WHERE ingest_run_id=$1', [directorConflictRun])).work_id, null);
    await stage(candidate('native-shared-seed', a, { external_identifiers: { imdb: 'tt8870001' } }), a);
    const cross = candidate('native-shared-sparse', bfi, { year: null, director_credit: null, external_id: '12932', external_identifiers: { bfi_nid: '12932', imdb: 'tt8870001' } });
    const crossRun = await stage(cross, bfi);
    const saved = await row('SELECT * FROM ingest_candidate WHERE ingest_run_id=$1', [crossRun]);
    assert.equal(saved.work_id, null); assert.match(saved.match_review, /insufficient metadata for shared/);
  });
  await test('untrusted or contradictory sparse identities remain REVIEW, including URLs and shared-only IDs', async () => {
    const bfi = { id: 'bfi_player_free', name: 'BFI', official_url: 'https://player.bfi.org.uk/' };
    const bad = [
      { external_identifiers: {}, external_id: 'https://player.bfi.org.uk/free/film/example' },
      { external_identifiers: { arbitrary: '12122' } },
      { external_identifiers: { constructor: '12122' } },
      { external_identifiers: { bfi_nid: 'https://example.org/12122' } },
      { external_identifiers: { bfi_nid: '0' } },
      { external_identifiers: { imdb: 'tt012122' } },
      { external_identifiers: { bfi_nid: ['12900', '12901'] } },
      { external_identifiers: { bfi_nid: '12902' }, year: 'unknown' },
      { external_identifiers: { bfi_nid: '12903' }, title: '', display_title: '', original_title: '' },
    ].map((extra, index) => candidate(`native-invalid-${index}`, bfi, { year: null, director_credit: null, ...extra }));
    const runId = await createRun(client, { registry: registry(bfi) });
    await persistEnumeration(client, runId, bfi, enumeration(bad));
    assert.equal(await count('ingest_candidate', 'WHERE ingest_run_id=$1 AND work_id IS NULL AND match_review IS NOT NULL', [runId]), bad.length);
    const seed = candidate('native-conflict-seed', bfi, { external_id: '12910', external_identifiers: { bfi_nid: '12910' }, director_credit: null });
    const seedRun = await stage(seed, bfi);
    const seedId = (await row('SELECT work_id FROM ingest_candidate WHERE ingest_run_id=$1', [seedRun])).work_id;
    for (const [index, extra] of [{ year: 1961 }, { runtime: 160 }, { countries: ['JP'] }, { external_id: '12911', external_identifiers: { bfi_nid: '12911' } }].entries()) {
      const run = await stage({ ...seed, ...extra }, bfi);
      const saved = await row('SELECT * FROM ingest_candidate WHERE ingest_run_id=$1', [run]);
      assert.equal(saved.work_id, null, `native conflict ${index}`); assert.ok(saved.match_review);
    }
    assert.equal((await row('SELECT director FROM work WHERE work_id=$1', [seedId])).director, null);
  });
  await test('BFI verification native enrichment overlays immutable discovery and new runs append without rewriting history', async () => {
    const bfi = { id: 'bfi_player_free', name: 'BFI', official_url: 'https://player.bfi.org.uk/' };
    const item = candidate('native-overlay', bfi, { year: null, director_credit: null, external_id: 'legacy-url', poster_url: null });
    const firstRun = await stage(item, bfi);
    const prior = await row('SELECT * FROM ingest_candidate WHERE ingest_run_id=$1', [firstRun]);
    assert.equal(prior.work_id, null);
    const proof = record(item, { runtime: 8, full_film_verified: false, free_verified: false, live_check_status: 'PENDING', watch_state: 'NO_VERIFIED_FREE_STREAM', metadata: { title: 'Structured title', display_title: 'Structured title', original_title: 'Structured original', year: 1959, director_credit: null, countries: ['United Kingdom'], external_id: '12920', external_identifiers: { bfi_nid: '12920' }, bfi_uuid: '34076722-44e4-53e5-ab82-e4288e27cd5f' } });
    const first = await persistVerification(client, firstRun, bfi, item, proof);
    assert.ok(first.workId); assert.equal(first.review, null); assert.equal(await publicCount(first.sourceId), 0);
    const savedCandidate = await row('SELECT * FROM ingest_candidate WHERE candidate_id=$1', [prior.candidate_id]);
    assert.deepEqual(savedCandidate.candidate_json, item); assert.equal(savedCandidate.snapshot_sha256, prior.snapshot_sha256);
    const savedProof = await row('SELECT * FROM source_verification WHERE verification_id=$1', [first.verificationId]);
    assert.equal(savedProof.record_json.metadata.external_id, '12920'); assert.equal(savedProof.record_json.metadata.original_title, 'Structured original');
    await finishSource(client, firstRun, bfi, {}); await finishRun(client, firstRun, {});
    const secondRun = await stage(item, bfi);
    const second = await persistVerification(client, secondRun, bfi, item, { ...proof, last_checked_at: new Date().toISOString() });
    assert.equal(second.workId, first.workId); assert.equal(second.sourceId, first.sourceId);
    assert.deepEqual(await row('SELECT * FROM source_verification WHERE verification_id=$1', [first.verificationId]), savedProof);
    assert.deepEqual(await row('SELECT * FROM ingest_candidate WHERE candidate_id=$1', [prior.candidate_id]), savedCandidate);
    await assertCode(persistVerification(client, firstRun, bfi, item, { ...proof, runtime: 9 }), 'INGESTION_CONFLICT');
  });
  await test('TMDb, Wikidata and ISAN retain shared matching with full clues, never sparse shared-only creation', async () => {
    for (const [scheme, id] of [['tmdb', '700001'], ['wikidata', 'Q700001'], ['isan', '0000-0000-7000-0001']]) {
      const original = candidate(`shared-${scheme}-a`, a, { external_identifiers: { [scheme]: id } });
      const firstRun = await stage(original, a);
      const firstId = (await row('SELECT work_id FROM ingest_candidate WHERE ingest_run_id=$1', [firstRun])).work_id;
      const translated = candidate(`shared-${scheme}-b`, b, { external_identifiers: { [scheme]: id } });
      const secondRun = await stage(translated, b);
      assert.equal((await row('SELECT work_id FROM ingest_candidate WHERE ingest_run_id=$1', [secondRun])).work_id, firstId);
      const sparseRun = await stage({ ...translated, director_credit: null }, b);
      assert.equal((await row('SELECT work_id FROM ingest_candidate WHERE ingest_run_id=$1', [sparseRun])).work_id, null);
      const conflictRun = await stage({ ...translated, year: 1961 }, b);
      assert.equal((await row('SELECT work_id FROM ingest_candidate WHERE ingest_run_id=$1', [conflictRun])).work_id, null);
    }
  });
  await test('aliases, Unicode, scoped and shared identifiers reuse identity only with nonconflicting clues', async () => {
    const runId = await createRun(client, { registry: registry(a, b, c) });
    const original = candidate('identity-origin', a, { title: 'L’Été 東', display_title: 'L’Été 東', original_title: 'L’Eté 東', alternate_titles: ['Summer 東'], external_id: 'same-provider-number', external_identifiers: { imdb: 'tt0112345', nfb_work: 'provider-work' } });
    await persistEnumeration(client, runId, a, enumeration([original]));
    const first = await row('SELECT work_id FROM ingest_candidate WHERE ingest_run_id=$1 AND registry_source_id=$2', [runId, a.id]);
    const alias = candidate('identity-alias', b, { title: 'Summer 東', display_title: 'Summer 東', original_title: 'Summer 東', external_id: 'same-provider-number' });
    const translated = candidate('identity-translated', b, { title: 'Un titre traduit entièrement différent', display_title: 'Un titre traduit entièrement différent', original_title: 'Un titre traduit entièrement différent', external_identifiers: { imdb: 'tt0112345' } });
    const different = candidate('identity-different', b, { external_id: 'other-provider-number' });
    await persistEnumeration(client, runId, b, enumeration([alias, translated, different]));
    const resolved = (await client.query('SELECT source_url,work_id FROM ingest_candidate WHERE ingest_run_id=$1 AND registry_source_id=$2', [runId, b.id])).rows;
    assert.equal(resolved.find((item) => item.source_url === alias.source_url).work_id, first.work_id);
    assert.equal(resolved.find((item) => item.source_url === translated.source_url).work_id, first.work_id);
    assert.notEqual(resolved.find((item) => item.source_url === different.source_url).work_id, first.work_id);
    const countryConflict = candidate('identity-country-conflict', c, { title: 'Summer 東', original_title: 'Summer 東', display_title: 'Summer 東', countries: ['JP'], external_identifiers: { imdb: 'tt0112345' } });
    const runtimeConflict = candidate('identity-runtime-conflict', c, { title: 'Summer 東', original_title: 'Summer 東', display_title: 'Summer 東', runtime: 160, external_identifiers: { imdb: 'tt0112345' } });
    const incompatibleShared = candidate('identity-shared-conflict', c, { title: 'Summer 東', original_title: 'Summer 東', display_title: 'Summer 東', external_identifiers: { imdb: 'tt0999999' } });
    const multipleShared = candidate('identity-multiple-shared', c, { external_identifiers: { imdb: ['tt0112345', 'tt0999999'] } });
    await persistEnumeration(client, runId, c, enumeration([countryConflict, runtimeConflict, incompatibleShared, multipleShared]));
    const conflicts = (await client.query('SELECT work_id,match_review FROM ingest_candidate WHERE ingest_run_id=$1 AND registry_source_id=$2', [runId, c.id])).rows;
    assert.equal(conflicts.length, 4); assert.ok(conflicts.every((item) => !item.work_id && item.match_review));
    assert.equal(await count('work_identifier', "WHERE namespace='shared:imdb' AND external_id='tt0999999'"), 0);
    const methods = (await client.query("SELECT match_method FROM work_resolution_event WHERE ingest_run_id=$1 AND decision='REUSED'", [runId])).rows.map((item) => item.match_method);
    assert.ok(methods.includes('metadata-alias')); assert.ok(methods.includes('shared-external-id'));
    assert.equal((await row("SELECT COUNT(DISTINCT registry_source_id)::integer AS n FROM work_external_id WHERE external_id='same-provider-number'")).n, 2);
  });
  await test('the same provider-local identifier in different registries is not a cross-source join', async () => {
    const first = candidate('namespace-a', a, { external_id: 'provider-only-collision', external_identifiers: { catalogue: 'same-local-value' } });
    const second = candidate('namespace-b', b, { external_id: 'provider-only-collision', external_identifiers: { catalogue: 'same-local-value' } });
    const firstRun = await stage(first, a); const secondRun = await stage(second, b);
    assert.notEqual((await row('SELECT work_id FROM ingest_candidate WHERE ingest_run_id=$1', [firstRun])).work_id, (await row('SELECT work_id FROM ingest_candidate WHERE ingest_run_id=$1', [secondRun])).work_id);
    assert.equal(await count('work_identifier', "WHERE identifier_scheme='catalogue' AND external_id='same-local-value'"), 2);
  });
  await test('ambiguous metadata and metadata without corroboration stay in review, not title-only joins', async () => {
    for (const [id, title, country, runtime] of [['fixture_twin_1', 'Uncertain Twin', ['FR'], 90], ['fixture_twin_2', 'Uncertain Twin', ['FR'], 90], ['fixture_sparse', 'Sparse Film', [], null]]) {
      await client.query('INSERT INTO work (work_id,stable_key,canonical_title,year,director,countries,runtime) VALUES ($1,$1,$2,1930,$3,$4::jsonb,$5)', [id, title, 'Fixture Director', JSON.stringify(country), runtime]);
      await client.query('INSERT INTO work_title (work_id,title,normalized_title) VALUES ($1,$2,$3)', [id, title, title.toLowerCase()]);
    }
    const twin = candidate('ambiguous', a, { title: 'Uncertain Twin', display_title: 'Uncertain Twin', original_title: 'Uncertain Twin', year: 1930, director_credit: 'Fixture Director' });
    const sparse = candidate('sparse', a, { title: 'Sparse Film', display_title: 'Sparse Film', original_title: 'Sparse Film', year: 1930, director_credit: 'Fixture Director', countries: [], runtime: null });
    const runId = await createRun(client, { registry: registry(a) });
    await persistEnumeration(client, runId, a, enumeration([twin, sparse]));
    const rows = (await client.query('SELECT * FROM ingest_candidate WHERE ingest_run_id=$1 ORDER BY source_url', [runId])).rows;
    assert.ok(rows.every((item) => item.work_id === null));
    assert.ok(rows.some((item) => /ambiguous/.test(item.match_review)));
    assert.ok(rows.some((item) => /corroboration/.test(item.match_review)));
    assert.equal(await count('media_asset', 'WHERE canonical_url=ANY($1::text[])', [[twin.poster_url, sparse.poster_url]]), 0);
  });
  await test('repeated sweeps preserve URL identity, newer current evidence and all prior snapshots', async () => {
    const item = candidate('repeated-url');
    const oldTime = new Date(Date.now() - 30000).toISOString();
    const newTime = new Date(Date.now() - 10000).toISOString();
    const olderTime = new Date(Date.now() - 60000).toISOString();
    const firstRun = await stage(item); const firstProof = record(item, { last_checked_at: oldTime });
    const first = await persistVerification(client, firstRun, a, item, firstProof);
    const firstRow = await row('SELECT * FROM source_verification WHERE verification_id=$1', [first.verificationId]);
    const firstEnumeration = await row('SELECT candidate_json FROM ingest_candidate WHERE ingest_run_id=$1', [firstRun]);
    const secondRun = await stage(item);
    const downgrade = record(item, { source_id: 'source_fixture_a_new_proposed_alias', last_checked_at: newTime, live_check_status: 'FAIL', lifecycle_status: 'EXPIRED', watch_state: 'NO_VERIFIED_FREE_STREAM', verification_evidence: [{ kind: 'LIVE_SOURCE', method: 'fixture 404', value: { http_status: 404 } }] });
    const second = await persistVerification(client, secondRun, a, item, downgrade);
    assert.equal(second.sourceId, first.sourceId); assert.equal(second.workId, first.workId); assert.equal(await publicCount(first.sourceId), 0);
    const current = await row('SELECT * FROM playback_source WHERE source_id=$1', [first.sourceId]);
    const thirdRun = await stage(item);
    const older = await persistVerification(client, thirdRun, a, item, record(item, { last_checked_at: olderTime }));
    assert.equal(older.currentUpdated, false);
    assert.deepEqual(await row('SELECT * FROM playback_source WHERE source_id=$1', [first.sourceId]), current);
    assert.equal((await persistVerification(client, firstRun, a, item, firstProof)).skipped, true);
    assert.deepEqual(await row('SELECT * FROM playback_source WHERE source_id=$1', [first.sourceId]), current);
    assert.deepEqual(await row('SELECT * FROM source_verification WHERE verification_id=$1', [first.verificationId]), firstRow);
    assert.deepEqual(await row('SELECT candidate_json FROM ingest_candidate WHERE ingest_run_id=$1', [firstRun]), firstEnumeration);
    // A later run with the same observation time wins using the existing latest-ID tie breaker.
    const fourthRun = await stage(item);
    assert.equal((await persistVerification(client, fourthRun, a, item, record(item, { last_checked_at: newTime }))).currentUpdated, true);
    assert.equal(await publicCount(first.sourceId), 1);
    assert.equal(await count('playback_source', 'WHERE registry_source_id=$1 AND canonical_source_url=$2', [a.id, item.source_url]), 1);
    assert.equal(await count('source_verification', 'WHERE source_id=$1', [first.sourceId]), 4);
    assert.equal(await count('media_asset', 'WHERE canonical_url=$1', [item.poster_url]), 1);
    const currentBeforeHistorical = await row('SELECT * FROM playback_source WHERE source_id=$1', [first.sourceId]);
    const historicalRun = await stage(item, a, 'HISTORICAL_IMPORT');
    const historical = await persistVerification(client, historicalRun, a, item, record(item, { last_checked_at: olderTime }));
    assert.equal(historical.currentUpdated, false);
    assert.deepEqual(await row('SELECT * FROM playback_source WHERE source_id=$1', [first.sourceId]), currentBeforeHistorical);
    assert.equal(await publicCount(first.sourceId), 1, 'an older historical assertion cannot replace newer current provider evidence');
    assert.equal((await row('SELECT verifier FROM source_verification WHERE verification_id=$1', [historical.verificationId])).verifier, 'legacy-report');
  });
  await test('seven-day, expiry, future, identity, embed and historical provenance gates remain fail-closed', async () => {
    const cases = [
      ['old-proof', {}, { last_checked_at: new Date(Date.now() - 8 * 86400000).toISOString() }, 0],
      ['expired-proof', {}, { availability_expiry_if_known: new Date(Date.now() - 1000).toISOString() }, 0],
      ['future-proof', {}, { last_checked_at: new Date(Date.now() + 86400000).toISOString() }, 0],
      ['missing-identity', { director_credit: null }, {}, 0],
      ['unproved-free', {}, { free_verified: false }, 0],
      ['unworking-embed', {}, { watch_state: 'WATCH_HERE', embed_status: 'PERMITTED', embed_working: false, embed_url_if_allowed: 'https://player.example/123', external_watch_url: null }, 0],
      ['working-embed', {}, { watch_state: 'WATCH_HERE', embed_status: 'PERMITTED', embed_working: true, embed_url_if_allowed: 'https://player.example/123' }, 1],
      ['legacy-assertion', {}, {}, 0, 'HISTORICAL_IMPORT'],
    ];
    for (const [key, candidateExtra, recordExtra, expected, mode] of cases) {
      const item = candidate(key, a, candidateExtra);
      const runId = await stage(item, a, mode);
      const saved = await persistVerification(client, runId, a, item, record(item, recordExtra));
      assert.equal(await publicCount(saved.sourceId), expected, key);
      if (mode) {
        assert.equal((await row('SELECT verifier FROM source_verification WHERE verification_id=$1', [saved.verificationId])).verifier, 'legacy-report');
        assert.equal((await row('SELECT last_checked_at FROM playback_source WHERE source_id=$1', [saved.sourceId])).last_checked_at, null);
      }
    }
    const item = candidate('no-structured-proof'); const runId = await stage(item);
    await assertCode(persistVerification(client, runId, a, item, record(item, { verification_evidence: [] })), 'INGESTION_INPUT');
    await assertCode(persistVerification(client, runId, a, item, record(item, { verification_evidence: ['HTTP 200'] })), 'INGESTION_INPUT');
    assert.equal(await count('source_verification', 'WHERE ingest_run_id=$1', [runId]), 0);
  });
  await test('conflicting URL identity downgrades current availability without reassignment or unlicensed artwork', async () => {
    const original = candidate('identity-immutable-url'); const firstRun = await stage(original);
    const first = await persistVerification(client, firstRun, a, original, record(original, { last_checked_at: new Date(Date.now() - 10000).toISOString() }));
    const conflict = { ...original, year: 2020, director_credit: 'Unrelated Director', poster_url: `${a.official_url}image/conflicting-work.jpg` };
    const secondRun = await stage(conflict);
    const result = await persistVerification(client, secondRun, a, conflict, record(conflict));
    assert.equal(result.workId, first.workId); assert.match(result.review, /conflicts/);
    assert.equal((await row('SELECT work_id FROM playback_source WHERE source_id=$1', [first.sourceId])).work_id, first.workId);
    assert.equal(await publicCount(first.sourceId), 0);
    assert.equal(await count('media_asset', 'WHERE canonical_url=$1', [conflict.poster_url]), 0);
  });
  await test('transaction errors roll back enumeration/identity atomically and permit a safe retry', async () => {
    const runId = await createRun(client, { registry: registry(a) });
    const bad = candidate('rollback', a, { poster_url: 'javascript:untrusted' });
    const before = { candidates: await count('ingest_candidate'), works: await count('work'), events: await count('work_resolution_event'), results: await count('ingest_source_result') };
    await assertCode(persistEnumeration(client, runId, a, enumeration([bad])), 'INGESTION_INPUT');
    assert.deepEqual({ candidates: await count('ingest_candidate'), works: await count('work'), events: await count('work_resolution_event'), results: await count('ingest_source_result') }, before);
    const good = { ...bad, poster_url: `${a.official_url}image/rollback.jpg` };
    await persistEnumeration(client, runId, a, enumeration([good]));
    const collisionId = (await row('SELECT source_id FROM playback_source LIMIT 1')).source_id;
    await assertCode(persistVerification(client, runId, a, good, record(good, { source_id: collisionId })), 'INGESTION_CONFLICT');
    assert.equal(await count('source_verification', 'WHERE ingest_run_id=$1', [runId]), 0);
    await assertCode(persistVerification(client, runId, a, good, record(good, { last_checked_at: 'not a date' })), 'INGESTION_INPUT');
    const proof = record(good);
    assert.ok((await persistVerification(client, runId, a, good, proof)).workId);
    const group = await row('SELECT * FROM ingest_source_result WHERE ingest_run_id=$1', [runId]);
    assert.deepEqual(group.result_json, enumeration([good]));
    const invalidCount = await count('ingest_run');
    await assertCode(createRun(client, { registry: registry(a, a) }), 'INGESTION_INPUT');
    assert.equal(await count('ingest_run'), invalidCount);
  });
  await test('concurrent same-run retries serialize without duplicate evidence or identities', async () => {
    const item = candidate('concurrent'); const runId = await createRun(client, { registry: registry(a) });
    const enums = await Promise.all([persistEnumeration(client, runId, a, enumeration([item])), persistEnumeration(observer, runId, a, enumeration([item]))]);
    assert.equal(enums.filter((item) => item.skipped).length, 1);
    const proof = record(item);
    const records = await Promise.all([persistVerification(client, runId, a, item, proof), persistVerification(observer, runId, a, item, proof)]);
    assert.equal(records.filter((item) => item.skipped).length, 1); assert.equal(records[0].sourceId, records[1].sourceId);
    assert.equal(await count('source_verification', 'WHERE ingest_run_id=$1', [runId]), 1);
    assert.equal(await count('ingest_candidate', 'WHERE ingest_run_id=$1', [runId]), 1);
  });
} finally {
  await client.end().catch(() => {}); await observer.end().catch(() => {});
  if (admin._connected) {
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch((error) => console.error(`isolated test database cleanup failed: ${error.message}`));
    await admin.end();
  }
}
