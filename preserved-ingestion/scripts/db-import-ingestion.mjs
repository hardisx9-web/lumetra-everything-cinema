import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import { normalize, resolveWork } from '../db/entity-resolution.mjs';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.error('DATABASE_URL is required; run db-migrate first.'); process.exit(2); }
const root = resolve(import.meta.dirname, '..');
const reportPath = process.env.INGESTION_REPORT || resolve(root, 'src/data/source-ingestion-report.json');
const content = await readFile(reportPath);
const digest = createHash('sha256').update(content).digest('hex');
const report = JSON.parse(content);
const registry = JSON.parse(await readFile(resolve(root, 'src/data/source-registry.json')));
const client = new pg.Client({ connectionString: databaseUrl, application_name: 'global-cinema-import' });
try {
  await client.connect();
  await client.query('BEGIN');
  // Serializes concurrent imports of this report and protects stable entity resolution.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['global-cinema-import']);
  const existing = await client.query('SELECT run_id FROM ingest_run WHERE report_sha256=$1', [digest]);
  if (existing.rowCount) {
    await client.query('COMMIT');
    console.log(JSON.stringify({ run_id: existing.rows[0].run_id, skipped: true, reason: 'report already imported' }));
  } else {
    for (const source of [...(registry.sources || []), ...(registry.rights_holder_channels_to_enumerate || [])]) {
      await client.query(`INSERT INTO source_registry (source_id,name,official_url,region,source_type,status,priority,free,embed_policy,default_watch_state,source_json)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
        ON CONFLICT (source_id) DO UPDATE SET name=EXCLUDED.name, official_url=EXCLUDED.official_url, source_json=EXCLUDED.source_json, updated_at=NOW()`,
      [source.id,source.name,source.official_url,source.region || null,source.type || null,source.status || 'UNKNOWN',source.priority || null,source.free === true,source.embed_policy || null,source.default_watch_state || null,JSON.stringify(source)]);
    }
    const run = await client.query(`INSERT INTO ingest_run (report_sha256,registry_version,mode,started_at,finished_at,status,counts,report_json)
      VALUES ($1,$2,$3,$4,$5,'HISTORICAL_IMPORT',$6::jsonb,$7::jsonb) RETURNING run_id`,
    [digest,report.registry?.version || null,report.run?.mode || 'VERIFY_DETAILS',report.run?.started_at || new Date().toISOString(),report.run?.finished_at || new Date().toISOString(),JSON.stringify(report.counts || {}),JSON.stringify(report)]);
    const runId = run.rows[0].run_id;
    let candidates = 0, works = 0, historicalVerified = 0, reviews = 0;
    for (const group of report.source_results || []) for (const record of group.records || []) {
      const m = record.metadata || {};
      await client.query(`INSERT INTO ingest_candidate (ingest_run_id,registry_source_id,external_id,source_url,title,normalized_title,year,director,runtime,poster_url,parser_id,candidate_status,rejection_reason,candidate_json)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb) ON CONFLICT DO NOTHING`,
      [runId,record.registry_source_id,m.external_id == null ? null : String(m.external_id),record.canonical_source_url,m.title || null,normalize(m.title),m.year || null,m.director_credit || null,record.runtime || null,m.poster_url || null,record.adapter_id || null,record.lifecycle_status || 'DISCOVERED',record.rejection_reason || null,JSON.stringify(record)]);
      candidates++;
      const historical = Boolean(record.full_film_verified && record.free_verified && record.official_or_rights_verified && record.live_check_status === 'PASS');
      // Keep every prior assertion and candidate, but never promote inherited claims to current verification.
      const resolved = historical ? await resolveWork(client,record) : { workId: null, review: null };
      if (resolved.workId) works++;
      if (resolved.review) reviews++;
      if (historical) historicalVerified++;
      if (resolved.workId && m.poster_url) await client.query(`INSERT INTO media_asset (work_id,asset_type,canonical_url,usage_basis,license_verified,source_id,metadata)
        VALUES ($1,'POSTER',$2,'SOURCE_IMAGE_LICENSE_UNVERIFIED',FALSE,$3,$4::jsonb) ON CONFLICT DO NOTHING`,
      [resolved.workId,m.poster_url,record.registry_source_id,JSON.stringify({ external_id: m.external_id })]);
      await client.query(`INSERT INTO playback_source (source_id,work_id,registry_source_id,source_owner,canonical_source_url,full_film_verified,free_verified,official_or_rights_verified,embed_status,embed_url_if_allowed,external_watch_url,territories,audio_languages,subtitle_languages,version_or_restoration,runtime,first_verified_at,last_checked_at,verification_evidence,availability_expiry_if_known,live_check_status,lifecycle_status,watch_state,adapter_id,metadata,historical_watch_state,match_review)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,$17,NULL,$18::jsonb,$19,'PENDING',$20,'NO_VERIFIED_FREE_STREAM',$21,$22::jsonb,$23,$24)
        ON CONFLICT (source_id) DO UPDATE SET historical_watch_state=COALESCE(playback_source.historical_watch_state,EXCLUDED.historical_watch_state), match_review=COALESCE(playback_source.match_review,EXCLUDED.match_review)`,
      [record.source_id,resolved.workId,record.registry_source_id,record.source_owner,record.canonical_source_url,Boolean(record.full_film_verified),Boolean(record.free_verified),Boolean(record.official_or_rights_verified),record.embed_status || 'UNKNOWN',record.embed_url_if_allowed || null,record.external_watch_url || null,JSON.stringify(record.territories || []),JSON.stringify(record.audio_languages || []),JSON.stringify(record.subtitle_languages || []),record.version_or_restoration || null,record.runtime || null,record.first_verified_at || null,JSON.stringify(record.verification_evidence || []),record.availability_expiry_if_known || null,historical ? 'REVIEW' : 'STAGED',record.adapter_id || null,JSON.stringify(m),record.watch_state || null,resolved.review]);
      await client.query(`INSERT INTO source_verification (source_id,checked_at,full_film_verified,free_verified,official_or_rights_verified,live_check_status,embed_status,watch_state,evidence,verifier,availability_expiry,ingest_run_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'legacy-report',$10,$11) ON CONFLICT DO NOTHING`,
      [record.source_id,record.last_checked_at || report.run?.finished_at || report.run?.started_at,Boolean(record.full_film_verified),Boolean(record.free_verified),Boolean(record.official_or_rights_verified),record.live_check_status || 'PENDING',record.embed_status || 'UNKNOWN',record.watch_state || 'NO_VERIFIED_FREE_STREAM',JSON.stringify(record.verification_evidence || []),record.availability_expiry_if_known || null,runId]);
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ run_id: runId, candidates, historical_verified: historicalVerified, resolved_works: works, match_reviews: reviews, currently_public: 0 }));
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(`PostgreSQL import failed: ${error.message}`);
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
