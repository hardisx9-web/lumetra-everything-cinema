import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { auditBaseline, createEmbedAuditRun, persistEmbedAuditResult, embedAuditReport } from './embed-audit-store.mjs';

// New, isolated schema; no production rows are copied, edited, reset or deleted.
// Drop only the schema created by THIS test, after closing its connection.
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for isolated PostgreSQL embed-audit tests');
const schema = `embed_test_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: 'global-cinema-embed-tests' });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: 'global-cinema-embed-tests-isolated' });
const checked = new Date(Date.now() - 60000).toISOString();
const result = (extra = {}) => ({ checked_at: new Date().toISOString(), outcome: 'MANUAL_REVIEW', permission_status: 'CONDITIONAL', technical_status: 'AVAILABLE_NOT_BROWSER_VERIFIED', reason_codes: ['PROJECT_USAGE_UNCONFIRMED'], error_code: null, evidence: [{ kind: 'EMBED_TEST', value: { no_media: true } }], ...extra });
let runId, baseline;
await admin.connect();
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await client.connect();
  await client.query(`SET search_path TO ${schema},pg_catalog`);
  for (const table of ['work','playback_source','source_verification','ingest_candidate','ingest_run']) await client.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
  await client.query(await readFile(new URL('./migrations/005_embed_audit.sql', import.meta.url), 'utf8'));
  await client.query(`INSERT INTO work (work_id,stable_key,canonical_title) VALUES ('w1','fixture1','Fixture One'),('w2','fixture2','Fixture Two')`);
  for (const [id,work,status] of [['s1','w1','WATCH_FREE_EXTERNALLY'],['s2','w1','WATCH_FREE_EXTERNALLY'],['s3','w2','NO_VERIFIED_FREE_STREAM']]) {
    await client.query(`INSERT INTO playback_source (source_id,work_id,registry_source_id,source_owner,canonical_source_url,external_watch_url,full_film_verified,free_verified,official_or_rights_verified,embed_status,live_check_status,lifecycle_status,watch_state,last_checked_at,verification_evidence)
      VALUES ($1,$2,'nfb_canada','NFB','https://www.nfb.ca/film/fixture/','https://www.nfb.ca/film/fixture/',TRUE,TRUE,TRUE,'UNKNOWN','PASS','VERIFIED',$3,$4,'[{"kind":"ORIGINAL_HEALTH"}]')`, [id,work,status,checked]);
  }
  // Explicit fixture IDs avoid advancing any copied default's production sequence.
  for (const [id,index] of [['s1',1],['s2',2]]) await client.query(`INSERT INTO source_verification (verification_id,source_id,checked_at,full_film_verified,free_verified,official_or_rights_verified,live_check_status,embed_status,watch_state,verifier,evidence)
    VALUES ($1,$2,$3,TRUE,TRUE,TRUE,'PASS','UNKNOWN','WATCH_FREE_EXTERNALLY','provider-health-check','[{"kind":"ORIGINAL_HEALTH"}]')`, [index,id,checked]);
  await test('cohort snapshots only existing PASS external records and canonical film associations', async () => {
    baseline = await auditBaseline(client); runId = await createEmbedAuditRun(client);
    const run = (await client.query('SELECT * FROM embed_audit_run WHERE run_id=$1',[runId])).rows[0];
    assert.equal(run.cohort_size,2);
    assert.equal((await client.query('SELECT COUNT(DISTINCT work_id)::integer AS n FROM embed_audit_item WHERE run_id=$1',[runId])).rows[0].n,1);
    assert.equal((await client.query('SELECT COUNT(*)::integer AS n FROM embed_audit_result')).rows[0].n,0);
    assert.deepEqual(await auditBaseline(client),baseline);
  });
  await test('embed decisions preserve free/live proof, independent timestamps, fallback and all original evidence', async () => {
    const before=(await client.query('SELECT * FROM playback_source WHERE source_id=\'s1\'')).rows[0];
    assert.equal(await persistEmbedAuditResult(client,runId,'s1',result()),true);
    const after=(await client.query('SELECT * FROM playback_source WHERE source_id=\'s1\'')).rows[0];
    for(const field of ['external_watch_url','canonical_source_url','full_film_verified','free_verified','official_or_rights_verified','live_check_status','last_checked_at','verification_evidence','metadata','work_id']) assert.deepEqual(after[field],before[field],field);
    assert.equal(after.embed_working,false); assert.equal(after.embed_url_if_allowed,null);
    assert.equal(after.watch_state,'WATCH_FREE_EXTERNALLY'); assert.ok(after.embed_checked_at);
    assert.deepEqual(await auditBaseline(client),baseline);
    const report=await embedAuditReport(client,runId);
    assert.equal(report.sources_audited,1);assert.equal(report.unique_films_audited,1);assert.equal(report.pending,1);
    assert.equal(report.watch_free_externally_remaining,2);assert.equal(report.preservation.passed,true);
    assert.equal(report.public_eligibility.sources,2);
  });
  await test('resume is idempotent and never changes already committed evidence', async () => {
    assert.equal(await persistEmbedAuditResult(client,runId,'s1',result({outcome:'TECHNICALLY_DISABLED',technical_status:'DISABLED'})),false);
    const pending=(await client.query(`SELECT i.source_id FROM embed_audit_item i LEFT JOIN embed_audit_result e USING(run_id,source_id) WHERE i.run_id=$1 AND e.source_id IS NULL`,[runId])).rows;
    assert.deepEqual(pending,[{source_id:'s2'}]);
    assert.equal((await client.query('SELECT outcome FROM embed_audit_result WHERE run_id=$1 AND source_id=\'s1\'',[runId])).rows[0].outcome,'MANUAL_REVIEW');
  });
  await test('fake permission or working boolean cannot promote a source', async () => {
    await assert.rejects(persistEmbedAuditResult(client,runId,'s2',result({outcome:'WATCH_HERE',permission_status:'VERIFIED',technical_status:'VERIFIED',embed_status:'PERMITTED',embed_working:true,embed_url_if_allowed:'https://www.nfb.ca/film/fixture/embed/player/'})),/REQUIRES_PROJECT_PERMISSION/);
    assert.equal((await client.query('SELECT COUNT(*)::integer AS n FROM embed_audit_result WHERE source_id=\'s2\'')).rows[0].n,0);
    assert.equal((await client.query('SELECT watch_state FROM playback_source WHERE source_id=\'s2\'')).rows[0].watch_state,'WATCH_FREE_EXTERNALLY');
  });
  await test('concurrent health/source changes are not overwritten or mislabeled', async () => {
    await client.query('UPDATE playback_source SET metadata=\'{"changed_by_health":true}\' WHERE source_id=\'s2\'');
    const before=(await client.query('SELECT * FROM playback_source WHERE source_id=\'s2\'')).rows[0];
    await persistEmbedAuditResult(client,runId,'s2',result());
    const after=(await client.query('SELECT * FROM playback_source WHERE source_id=\'s2\'')).rows[0];
    assert.deepEqual(after,before);
    const audit=(await client.query('SELECT * FROM embed_audit_result WHERE run_id=$1 AND source_id=\'s2\'',[runId])).rows[0];
    assert.equal(audit.applied,false);assert.equal(audit.error_code,'SOURCE_CHANGED_SINCE_AUDIT_SNAPSHOT');
    assert.equal((await embedAuditReport(client,runId)).pending,0);
  });
  await test('separate verified embed proof publishes without rewriting independent health history', async () => {
    const nextRun=await createEmbedAuditRun(client), url='https://www.nfb.ca/film/fixture/', player=`${url}embed/player/`;
    const permission={kind:'EMBED_PROJECT_PERMISSION',value:{permitted:true,usage_reviewed:true,attribution_verified:true,origin:'https://global-cinema.example'}};
    const playback={kind:'EMBED_BROWSER_PLAYBACK',url:player,value:{played:true,third_party_iframe:true,provider_controls_preserved:true,restrictions_bypassed:false,origin:'https://global-cinema.example'}};
    const offer={kind:'EMBED_PROVIDER_OFFER',url,value:{observed_player_url:player,origin:'PROVIDER_SHARE_TEMPLATE'}};
    const identity={kind:'EMBED_PLAYER_CONFIG',url:player,value:{identity_matches:true,full_film:true,embed_mode:true,provider_logo_and_share_enabled:true,required_linkback_observed:true}};
    await persistEmbedAuditResult(client,nextRun,'s1',result({outcome:'WATCH_HERE',permission_status:'VERIFIED',technical_status:'VERIFIED',embed_status:'PERMITTED',embed_working:true,embed_url_if_allowed:player,evidence:[permission,playback,offer,identity],reason_codes:[]}));
    const p=(await client.query("SELECT * FROM playback_source WHERE source_id='s1'")).rows[0];
    assert.equal(p.watch_state,'WATCH_HERE');assert.equal(p.embed_url_if_allowed,player);assert.equal(p.external_watch_url,url);
    assert.equal((await client.query("SELECT COUNT(*)::integer AS n FROM public_watchable_sources WHERE watch_state='WATCH_HERE'")).rows[0].n,1);
    assert.equal((await client.query("SELECT embed_working FROM source_verification WHERE source_id='s1'")).rows[0].embed_working,false);
    assert.equal((await embedAuditReport(client,nextRun)).preservation.passed,true);
    await client.query("UPDATE embed_audit_result SET checked_at=NOW()-INTERVAL '8 days' WHERE run_id=$1 AND source_id='s1'",[nextRun]);
    assert.equal((await client.query("SELECT COUNT(*)::integer AS n FROM public_watchable_sources WHERE watch_state='WATCH_HERE'")).rows[0].n,0);
  });
} finally {
  await client.end().catch(()=>{});
  await admin.query(`DROP SCHEMA ${schema} CASCADE`).catch(()=>{});
  await admin.end();
}
