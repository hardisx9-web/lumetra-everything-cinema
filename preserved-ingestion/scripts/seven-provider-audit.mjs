import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import { NEW_PROVIDER_IDS } from '../lib/ingestion/provider-policy.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
const output = process.argv.find(a => a.startsWith('--output='))?.slice(9);
const compare = process.argv.find(a => a.startsWith('--compare='))?.slice(10);
if (!output) throw new Error('--output= audit file required');
const baseline = compare ? JSON.parse(await readFile(resolve(compare), 'utf8')) : null;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: 'global-cinema-seven-provider-readonly-audit' });
const targets = [...NEW_PROVIDER_IDS];
try {
  await client.connect(); await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const cutoff = baseline?.cutoff || (await client.query('SELECT clock_timestamp() AS at')).rows[0].at.toISOString();
  const sets = {
    original_works: ['SELECT * FROM work WHERE created_at <= $1', [cutoff]],
    completed_provider_playback: ['SELECT * FROM playback_source WHERE registry_source_id <> ALL($1::text[])', [targets]],
    completed_provider_verifications: ['SELECT v.* FROM source_verification v JOIN playback_source p USING(source_id) WHERE p.registry_source_id <> ALL($1::text[])', [targets]],
    completed_provider_registry: ['SELECT * FROM source_registry WHERE source_id <> ALL($1::text[])', [targets]],
    original_runs: ['SELECT * FROM ingest_run WHERE created_at <= $1', [cutoff]],
    original_candidates: ['SELECT * FROM ingest_candidate WHERE created_at <= $1', [cutoff]],
    original_source_results: ['SELECT * FROM ingest_source_result WHERE enumeration_persisted_at <= $1', [cutoff]],
    embed_audit_runs: ['SELECT * FROM embed_audit_run', []],
    embed_audit_items: ['SELECT * FROM embed_audit_item', []],
    embed_audit_results: ['SELECT * FROM embed_audit_result', []],
  };
  const protectedData = {};
  for (const [name, [query, params]] of Object.entries(sets)) {
    const row = (await client.query(`SELECT count(*)::integer AS rows, md5(COALESCE(string_agg(md5(row_to_json(x)::text),'|' ORDER BY row_to_json(x)::text),'')) AS content_digest FROM (${query}) x`, params)).rows[0];
    protectedData[name] = row;
  }
  const totals = (await client.query(`SELECT (SELECT count(*)::integer FROM work) works,
    (SELECT count(*)::integer FROM playback_source) playback_sources,
    (SELECT count(DISTINCT work_id)::integer FROM public_watchable_sources) verified_free_unique_films,
    (SELECT count(*)::integer FROM public_watchable_sources WHERE watch_state='WATCH_HERE') watch_here_sources,
    (SELECT count(DISTINCT work_id)::integer FROM public_watchable_sources WHERE watch_state='WATCH_HERE') watch_here_unique_films,
    (SELECT count(*)::integer FROM public_watchable_sources WHERE watch_state='WATCH_FREE_EXTERNALLY') watch_free_externally_sources,
    (SELECT count(DISTINCT work_id)::integer FROM public_watchable_sources WHERE watch_state='WATCH_FREE_EXTERNALLY') watch_free_externally_unique_films`)).rows[0];
  await client.query('COMMIT');
  const paths = ['src/data/source-registry.json', 'src/data/source-ingestion-report.json', '.research/embed-audit-report.json', '.research/embed-audit-checkpoint.json', '.research/sweeps/resumed-source-sweep/manifest.json', '.research/sweeps/resumed-source-sweep/nfb_canada.json'];
  const files = {};
  for (const path of paths) files[path] = createHash('sha256').update(await readFile(resolve(path))).digest('hex');
  const preservation = baseline ? { database_unchanged: JSON.stringify(protectedData) === JSON.stringify(baseline.protected_data), protected_files_unchanged: JSON.stringify(files) === JSON.stringify(baseline.protected_files) } : null;
  const report = { generated_at: new Date().toISOString(), cutoff, scope: targets, protected_data: protectedData, protected_files: files, database_totals: totals, preservation };
  await writeFile(resolve(output), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ output, database_totals: totals, preservation }));
  if (preservation && (!preservation.database_unchanged || !preservation.protected_files_unchanged)) process.exitCode = 1;
} finally { await client.end(); }
