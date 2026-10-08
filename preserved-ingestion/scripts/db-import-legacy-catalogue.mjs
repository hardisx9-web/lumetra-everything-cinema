import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import { films } from '../src/data/catalogue.js';
import { normalize } from '../db/entity-resolution.mjs';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required.'); process.exit(2); }
const file = resolve(import.meta.dirname, '../src/data/catalogue.js');
const digest = createHash('sha256').update(await readFile(file)).digest('hex');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: 'global-cinema-editorial-import' });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['global-cinema-import']);
  const existing = await client.query('SELECT run_id FROM ingest_run WHERE report_sha256=$1',[digest]);
  if (existing.rowCount) {
    await client.query('COMMIT');
    console.log(JSON.stringify({ run_id: existing.rows[0].run_id, skipped: true }));
  } else {
    await client.query(`INSERT INTO source_registry (source_id,name,official_url,status,free,source_json)
      VALUES ('legacy_internet_archive','Internet Archive (editorial seed)','https://archive.org/','REVIEW',FALSE,'{}'::jsonb) ON CONFLICT DO NOTHING`);
    const importedAt = new Date().toISOString();
    const run = await client.query(`INSERT INTO ingest_run (report_sha256,mode,started_at,finished_at,status,counts,report_json)
      VALUES ($1,'LEGACY_EDITORIAL',$2,$2,'HISTORICAL_IMPORT',$3::jsonb,$4::jsonb) RETURNING run_id`,
    [digest,importedAt,JSON.stringify({ works: films.length, archive_sources: films.reduce((sum,film) => sum + (film.availability?.sources?.length || 0),0) }),JSON.stringify({ description: 'Editorial seed import; not playback verification', source: 'src/data/catalogue.js' })]);
    let sources = 0;
    for (const film of films) {
      await client.query(`INSERT INTO work (work_id,stable_key,canonical_title,original_title,year,director,countries,alternate_titles,runtime,metadata,verification_level,coverage_tier)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11,$12) ON CONFLICT (work_id) DO NOTHING`,
      [film.id,`editorial:${film.id}`,film.title,film.originalTitle || film.title,film.year || null,film.director || null,JSON.stringify(film.countries || []),JSON.stringify(film.alternateTitles || []),film.runtime || null,JSON.stringify(film),film.verification || 'PROVISIONAL',film.coverageTier || 0]);
      for (const [index,title] of [...new Set([film.title,film.originalTitle,film.displayTitle,...(film.alternateTitles || [])].filter(Boolean))].entries()) {
        await client.query(`INSERT INTO work_title (work_id,title,normalized_title,title_type) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[film.id,title,normalize(title),index === 0 ? 'ORIGINAL' : 'ALTERNATE']);
      }
      if (film.poster?.url) await client.query(`INSERT INTO media_asset (work_id,asset_type,canonical_url,usage_basis,license_verified,metadata)
        VALUES ($1,'POSTER',$2,'EDITORIAL_SEED_LICENSE_UNVERIFIED',FALSE,$3::jsonb) ON CONFLICT DO NOTHING`,[film.id,film.poster.url,JSON.stringify(film.poster)]);
      for (const source of film.availability?.sources || []) {
        const sourceId = `legacy_${createHash('sha256').update(`${film.id}|${source.url}`).digest('hex').slice(0,24)}`;
        await client.query(`INSERT INTO ingest_candidate (ingest_run_id,registry_source_id,source_url,title,normalized_title,year,director,runtime,candidate_status,candidate_json)
          VALUES ($1,'legacy_internet_archive',$2,$3,$4,$5,$6,$7,'HISTORICAL',$8::jsonb) ON CONFLICT DO NOTHING`,
        [run.rows[0].run_id,source.url,film.title,normalize(film.title),film.year || null,film.director || null,film.runtime || null,JSON.stringify(source)]);
        await client.query(`INSERT INTO playback_source (source_id,work_id,registry_source_id,source_owner,canonical_source_url,full_film_verified,free_verified,official_or_rights_verified,embed_status,external_watch_url,live_check_status,lifecycle_status,watch_state,adapter_id,metadata,historical_watch_state,verification_evidence)
          VALUES ($1,$2,'legacy_internet_archive',$3,$4,FALSE,FALSE,FALSE,'UNKNOWN',$4,'PENDING','REVIEW','NO_VERIFIED_FREE_STREAM',$5,$6::jsonb,$7,$8::jsonb) ON CONFLICT DO NOTHING`,
        [sourceId,film.id,source.provider || 'Internet Archive',source.url,source.adapter || null,JSON.stringify(source),source.watch_state || 'NO_VERIFIED_FREE_STREAM',JSON.stringify([source.note || 'Archive item retained for edition and rights review.'])]);
        await client.query(`INSERT INTO source_verification (source_id,checked_at,full_film_verified,free_verified,official_or_rights_verified,live_check_status,embed_status,watch_state,evidence,verifier,ingest_run_id)
          VALUES ($1,$2,FALSE,FALSE,FALSE,'PENDING','UNKNOWN','NO_VERIFIED_FREE_STREAM',$3::jsonb,'legacy-report',$4) ON CONFLICT DO NOTHING`,
        [sourceId,importedAt,JSON.stringify([source.note || 'Historical editorial archive link; not rights-cleared playback.']),run.rows[0].run_id]);
        sources++;
      }
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ run_id: run.rows[0].run_id, editorial_works: films.length, archive_sources: sources, currently_public: 0 }));
  }
} catch (error) { await client.query('ROLLBACK').catch(() => {}); console.error(`Editorial history import failed: ${error.message}`); process.exitCode=1; }
finally { await client.end().catch(() => {}); }
