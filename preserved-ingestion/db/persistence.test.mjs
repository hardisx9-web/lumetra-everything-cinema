import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import pg from 'pg';
import { normalize, resolveWork } from './entity-resolution.mjs';
import { inspectProvider } from './provider-health.mjs';

const root = resolve(import.meta.dirname, '..');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL required for real PostgreSQL integration tests');
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = '/postgres';
const testDatabase = `gc_persistence_test_${process.pid}`;
const testUrl = new URL(databaseUrl);
testUrl.pathname = `/${testDatabase}`;
const admin = new pg.Client({ connectionString: adminUrl.href });
const client = new pg.Client({ connectionString: testUrl.href });
const command = (script, args = [], extraEnv = {}) => execFileSync(process.execPath, [resolve(root, 'scripts', script), ...args], { cwd: root, env: { ...process.env, DATABASE_URL: testUrl.href, ...extraEnv }, encoding: 'utf8' });
try {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${testDatabase}`);
  await client.connect();
  await test('migrate and import legacy evidence exactly once, never publish it', async () => {
    assert.match(command('db-migrate.mjs'), /applied 002/);
    const first = JSON.parse(command('db-import-ingestion.mjs'));
    assert.equal(first.candidates, 479);
    assert.equal(first.historical_verified, 12);
    assert.equal(first.currently_public, 0);
    assert.equal(JSON.parse(command('db-import-ingestion.mjs')).skipped, true);
    const editorial = JSON.parse(command('db-import-legacy-catalogue.mjs'));
    assert.equal(editorial.editorial_works,21);
    assert.equal(editorial.archive_sources,4);
    assert.equal(JSON.parse(command('db-import-legacy-catalogue.mjs')).skipped,true);
    assert.match(command('db-migrate.mjs'), /skip 003/);
    const counts = (await client.query(`SELECT (SELECT COUNT(*) FROM ingest_run) runs,(SELECT COUNT(*) FROM ingest_candidate) candidates,(SELECT COUNT(*) FROM playback_source) sources,(SELECT COUNT(*) FROM work) works,(SELECT COUNT(*) FROM source_verification) history,(SELECT COUNT(*) FROM public_watchable_sources) public`)).rows[0];
    assert.deepEqual(Object.values(counts).map(Number), [2,483,483,33,483,0]);
    const legacy = await client.query("SELECT COUNT(*) FROM source_verification WHERE verifier='legacy-report' AND live_check_status='PASS'");
    assert.equal(Number(legacy.rows[0].count),12);
    assert.equal(JSON.parse(command('db-export-public.mjs')).ingestedFilms.length,0);
  });
  await test('distinct report versions retain same-timestamp evidence without republishing', async () => {
    const temp = await mkdtemp(resolve(tmpdir(),'gc-report-'));
    try {
      const report = JSON.parse(await readFile(resolve(root,'src/data/source-ingestion-report.json')));
      report.source_results.find((group) => group.records.length).records[0].verification_evidence.push('Second historical observation; same checked-at timestamp.');
      const path = resolve(temp,'report.json');
      await writeFile(path,JSON.stringify(report));
      assert.equal(JSON.parse(command('db-import-ingestion.mjs',[],{ INGESTION_REPORT:path })).candidates,479);
      assert.equal(Number((await client.query('SELECT COUNT(*) FROM source_verification')).rows[0].count),962);
      assert.equal(Number((await client.query('SELECT COUNT(*) FROM public_watchable_sources')).rows[0].count),0);
    } finally { await rm(temp,{recursive:true,force:true}); }
  });
  await test('conservative Unicode matching, external namespaces, conflicting clues and ambiguous matches', async () => {
    const base = { registry_source_id: 'cinematheque_henri', metadata: { title: 'L’Été 東', original_title: 'L’Eté 東', alternate_titles: ['Summer 東'], year: 1960, director_credit: 'René Åki', external_id: 'entity-fixture', countries: ['FR'] }, runtime: 90 };
    assert.equal(normalize('L’Été 東'),normalize('L’Eté 東'));
    const first = await resolveWork(client,base);
    assert.ok(first.workId);
    assert.equal((await resolveWork(client,{ ...base, metadata: { ...base.metadata, title: 'Summer 東', external_id: 'entity-fixture-2' } })).workId,first.workId);
    assert.equal((await resolveWork(client,{ ...base, metadata: { ...base.metadata, director_credit: 'Other Director', external_id: 'entity-fixture' } })).workId,null);
    assert.notEqual((await resolveWork(client,{ ...base, registry_source_id: 'mosfilm', metadata: { ...base.metadata, title: 'Different Title', original_title: 'Different Title', alternate_titles: [], external_id: 'entity-fixture' } })).workId,first.workId);
    assert.notEqual((await resolveWork(client,{ ...base, metadata: { ...base.metadata, title: 'Summer 東', external_id: 'entity-fixture-3', countries: ['JP'] } })).workId,first.workId);
    assert.notEqual((await resolveWork(client,{ ...base, metadata: { ...base.metadata, title: 'Summer 東', external_id: 'entity-fixture-4' }, runtime: 160 })).workId,first.workId);
    assert.equal((await resolveWork(client,{ ...base, metadata: { title:'Unknown', external_id:'missing' } })).workId,null);
  });
  await test('provider HTTP 200 is not a playback pass; expired/dead fail closed', async () => {
    const source = { canonical_source_url:'https://www.cinematheque.fr/henri/film/123/', registry_source_id:'cinematheque_henri', metadata:{title:'Example'} };
    const fetchPage = async () => ({ ok:true,status:200,body:'<h1>Example</h1><iframe src="https://player.vimeo.com/video/123"></iframe>',finalUrl:source.canonical_source_url });
    const check = await inspectProvider(source,fetchPage);
    assert.equal(check.status,'PENDING');
    assert.equal(check.reason,'invalid-player-config');
    assert.equal((await inspectProvider({ ...source, availability_expiry_if_known:new Date(0) },fetchPage)).status,'FAIL');
    assert.equal((await inspectProvider(source,async () => ({ status:404,ok:false,body:'',finalUrl:source.canonical_source_url }))).status,'FAIL');
  });
  await test('database view enforces provider freshness, expiry, embed working and most recent downgrade', async () => {
    const source = (await client.query("SELECT source_id FROM playback_source WHERE historical_watch_state='WATCH_FREE_EXTERNALLY' LIMIT 1")).rows[0].source_id;
    await client.query('BEGIN');
    try {
      await client.query("UPDATE playback_source SET lifecycle_status='VERIFIED',live_check_status='PASS',watch_state='WATCH_FREE_EXTERNALLY',last_checked_at=NOW() WHERE source_id=$1",[source]);
      // A claimed PASS in old ingestion cannot pass the verifier gate.
      assert.equal(Number((await client.query('SELECT COUNT(*) FROM public_watchable_sources WHERE source_id=$1',[source])).rows[0].count),0);
      const add = async (checked,verifier,embedWorking=false) => client.query(`INSERT INTO source_verification (source_id,checked_at,full_film_verified,free_verified,official_or_rights_verified,live_check_status,embed_status,watch_state,verifier,embed_working)
        VALUES ($1,$2,TRUE,TRUE,TRUE,'PASS','PROHIBITED','WATCH_FREE_EXTERNALLY',$3,$4)`,[source,checked,verifier,embedWorking]);
      await add((await client.query('SELECT NOW() AS checked')).rows[0].checked,'provider-health-check');
      await client.query(`UPDATE playback_source SET last_checked_at=(SELECT MAX(checked_at) FROM source_verification WHERE source_id=$1) WHERE source_id=$1`,[source]);
      assert.equal(Number((await client.query('SELECT COUNT(*) FROM public_watchable_sources WHERE source_id=$1',[source])).rows[0].count),1);
      assert.equal(JSON.parse(command('db-export-public.mjs')).ingestedFilms.length,0, 'separate connection must not see uncommitted changes');
      await client.query("UPDATE playback_source SET watch_state='WATCH_HERE',embed_status='PERMITTED',embed_url_if_allowed='https://player.vimeo.com/video/123' WHERE source_id=$1",[source]);
      assert.equal(Number((await client.query('SELECT COUNT(*) FROM public_watchable_sources WHERE source_id=$1',[source])).rows[0].count),0);
      await client.query('UPDATE playback_source SET embed_working=TRUE WHERE source_id=$1',[source]);
      assert.equal(Number((await client.query('SELECT COUNT(*) FROM public_watchable_sources WHERE source_id=$1',[source])).rows[0].count),0);
      await client.query('UPDATE source_verification SET embed_working=TRUE WHERE source_id=$1 AND verifier=$2',[source,'provider-health-check']);
      assert.equal(Number((await client.query('SELECT COUNT(*) FROM public_watchable_sources WHERE source_id=$1',[source])).rows[0].count),1);
      await client.query("UPDATE playback_source SET availability_expiry_if_known=NOW()-INTERVAL '1 minute' WHERE source_id=$1",[source]);
      assert.equal(Number((await client.query('SELECT COUNT(*) FROM public_watchable_sources WHERE source_id=$1',[source])).rows[0].count),0);
      await client.query('UPDATE playback_source SET availability_expiry_if_known=NULL WHERE source_id=$1',[source]);
      await client.query("UPDATE source_verification SET checked_at=NOW()-INTERVAL '8 days' WHERE source_id=$1 AND verifier='provider-health-check'",[source]);
      await client.query("UPDATE playback_source SET last_checked_at=NOW()-INTERVAL '8 days' WHERE source_id=$1",[source]);
      assert.equal(Number((await client.query('SELECT COUNT(*) FROM public_watchable_sources WHERE source_id=$1',[source])).rows[0].count),0);
    } finally { await client.query('ROLLBACK'); }
  });
  await test('derived export publishes only current rows and automatic downgrade removes them without erasing history', async () => {
    const source = (await client.query("SELECT source_id FROM playback_source WHERE historical_watch_state='WATCH_FREE_EXTERNALLY' LIMIT 1")).rows[0].source_id;
    await client.query('BEGIN');
    const fresh = (await client.query('SELECT NOW() AS t')).rows[0].t;
    await client.query("UPDATE playback_source SET lifecycle_status='VERIFIED',live_check_status='PASS',watch_state='WATCH_FREE_EXTERNALLY',last_checked_at=$2 WHERE source_id=$1",[source,fresh]);
    await client.query(`INSERT INTO source_verification (source_id,checked_at,full_film_verified,free_verified,official_or_rights_verified,live_check_status,embed_status,watch_state,verifier)
      VALUES ($1,$2,TRUE,TRUE,TRUE,'PASS','PROHIBITED','WATCH_FREE_EXTERNALLY','provider-health-check')`,[source,fresh]);
    await client.query('COMMIT');
    const exportRecord = JSON.parse(command('db-export-public.mjs'));
    assert.equal(exportRecord.ingestedFilms.length,1);
    assert.equal(exportRecord.ingestedFilms[0].availability.sources[0].source_id,source);
    assert.equal(exportRecord.ingestedFilms[0].poster,null,'unlicensed poster must not be exported');
    await client.query('BEGIN');
    const newer = (await client.query('SELECT NOW() AS t')).rows[0].t;
    await client.query("INSERT INTO source_verification (source_id,checked_at,full_film_verified,free_verified,official_or_rights_verified,live_check_status,embed_status,watch_state,verifier) VALUES ($1,$2,FALSE,FALSE,FALSE,'PENDING','PROHIBITED','NO_VERIFIED_FREE_STREAM','provider-health-check')",[source,newer]);
    await client.query("UPDATE playback_source SET lifecycle_status='REVIEW',live_check_status='PENDING',watch_state='NO_VERIFIED_FREE_STREAM',last_checked_at=$2 WHERE source_id=$1",[source,newer]);
    await client.query('COMMIT');
    assert.equal(JSON.parse(command('db-export-public.mjs')).ingestedFilms.length,0);
    assert.equal(Number((await client.query('SELECT COUNT(*) FROM source_verification WHERE source_id=$1',[source])).rows[0].count),4);
  });
} finally {
  await client.end().catch(() => {});
  if (admin._connected) {
    await admin.query(`DROP DATABASE IF EXISTS ${testDatabase} WITH (FORCE)`).catch((error) => { console.error(`test database cleanup failed: ${error.message}`); });
    await admin.end();
  }
}
