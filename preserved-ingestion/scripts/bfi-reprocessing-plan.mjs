import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { snapshotHash } from '../db/entity-resolution.mjs';
import { enumerateSource } from '../lib/ingestion/catalogues.mjs';
import { httpForSource } from '../lib/ingestion/provider-policy.mjs';

const SOURCE = 'bfi_player_free';
const tally = (items, key) => items.reduce((counts, item) => { const value = key(item) || 'NONE'; counts[value] = (counts[value] || 0) + 1; return counts; }, {});

// Pure projection: historical snapshots are inputs only. The transport contains
// NEW structured candidates, not edits/replays of the old immutable candidates.
export function prepareBfiReprocessingPlan(rows, catalogue, { runId, requests = [], policyEvidence = [] }) {
  if (!catalogue.enumeration_complete) throw new Error(`Fresh BFI metadata enumeration incomplete: ${catalogue.blocker || catalogue.status}`);
  const byUrl = new Map(), nativeIds = new Set();
  for (const item of catalogue.candidates) {
    const nid = item.external_identifiers?.bfi_nid;
    if (item.registry_source_id !== SOURCE || typeof nid !== 'string' || !/^[1-9]\d*$/.test(nid) || nativeIds.has(nid) || byUrl.has(item.source_url)) throw new Error('Invalid or ambiguous fresh BFI identity');
    byUrl.set(item.source_url, item); nativeIds.add(nid);
  }
  const affected = rows.filter(row => row.work_id == null && row.match_review === 'missing title/year/director');
  const eligible = affected.filter(row => row.current_work_id == null);
  const unmatched = [], targets = [], candidates = [];
  for (const row of eligible) {
    if (!row.source_id || row.current_source_url !== row.source_url) throw new Error('Historical/current playback URL identity is missing or conflicting');
    const item = byUrl.get(row.source_url);
    if (!item) { unmatched.push({ candidate_id: row.candidate_id, source_id: row.source_id, source_url: row.source_url }); continue; }
    const provenance = { run_id: runId, candidate_id: row.candidate_id, candidate_snapshot_sha256: row.snapshot_sha256, verification_id: row.verification_id, verification_record_sha256: row.record_sha256, source_id: row.source_id };
    candidates.push({ ...structuredClone(item), reprocessing_provenance: provenance });
    targets.push({ ...provenance, source_url: row.source_url, nid: item.external_identifiers.bfi_nid, previous_error_code: row.error_code });
  }
  const report = { historical_run_id: runId, registry_source_id: SOURCE, database_access: 'READ_ONLY', reprocessing_executed: false,
    historical_candidates: rows.length, historical_identity_reviews: affected.length,
    excluded_already_resolved_current_sources: affected.length - eligible.length,
    fresh_catalogue_records: catalogue.candidates.length, proposed_reprocessing_candidates: candidates.length,
    unmatched_historical_urls: unmatched.length, unmatched,
    previous_errors_in_proposed_cohort: tally(targets, item => item.previous_error_code),
    fresh_metadata_in_proposed_cohort: tally(candidates, item => item.year && item.director_credit ? 'year_and_director' : item.year ? 'year_without_director' : item.director_credit ? 'director_without_year' : 'neither_year_nor_director'),
    target_sha256: snapshotHash(targets), targets,
    mechanism: 'New BFI-only ingestion-store run via sweep-sources --source=bfi_player_free --enumeration-dir=<this new transport directory>; no --resume of historical run.',
    effects: ['Resolve only the selected fresh candidates through the normal resolver.', 'Append new candidate, resolution-event and verification observations in a new run.', 'Reuse existing playback source identity by original canonical source URL; only newer observations may update current playback state.', 'Do not alter historical run/candidate/verification snapshots or manually assign work IDs.', 'Replay redirects remain outside the audited playback contract; native identity does not establish watchability.'] };
  const enumeration = { status: 'FOCUSED_REPROCESSING_COHORT', enumeration_complete: false, candidates,
    catalogue_scope: 'Focused historical BFI identity-review cohort, joined by exact URL to fresh authoritative free-pillar search metadata; NOT provider-wide discovery.',
    cohort_provenance: { historical_run_id: runId, target_sha256: report.target_sha256, proposed_reprocessing_candidates: candidates.length, unmatched_historical_urls: unmatched.length },
    requests, policy_evidence: policyEvidence, checked_at: new Date().toISOString() };
  return { report, enumeration };
}

async function main() {
  const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (process.argv.slice(2).some(arg => !/^--(?:run|output-dir)=/.test(arg))) throw new Error('Only --run and --output-dir are supported. This command cannot execute reprocessing.');
  const runId = option('run');
  if (!runId || !process.env.DATABASE_URL) throw new Error('--run=<historical UUID> and DATABASE_URL are required');
  const registry = JSON.parse(await readFile(resolve(import.meta.dirname, '../src/data/source-registry.json'), 'utf8'));
  const source = registry.sources.find(item => item.id === SOURCE);
  if (!source) throw new Error('BFI source is absent from the registry');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: 'global-cinema-bfi-plan-read-only' });
  let rows;
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const run = (await client.query('SELECT finished_at,store_version FROM ingest_run WHERE run_id=$1', [runId])).rows[0];
    if (!run?.finished_at || run.store_version !== 1) throw new Error('Plan requires a finished ingestion-store run; no running run is changed');
    rows = (await client.query(`SELECT c.candidate_id,c.source_url,c.work_id,c.match_review,c.snapshot_sha256,
      v.verification_id,v.record_sha256,v.error_code,v.source_id,
      p.work_id AS current_work_id,p.canonical_source_url AS current_source_url
      FROM ingest_candidate c LEFT JOIN source_verification v ON v.ingest_run_id=c.ingest_run_id AND v.candidate_id=c.candidate_id
      LEFT JOIN playback_source p ON p.source_id=v.source_id
      WHERE c.ingest_run_id=$1 AND c.registry_source_id=$2 ORDER BY c.source_url`, [runId, SOURCE])).rows;
    if (!rows.length || rows.some(row => !row.verification_id)) throw new Error('Historical BFI cohort is empty or has unchecked candidates');
    await client.query('COMMIT');
  } finally { await client.end(); }
  const http = httpForSource(source);
  const catalogue = await enumerateSource(source, http);
  const { report, enumeration } = prepareBfiReprocessingPlan(rows, catalogue, { runId, requests: http.requests, policyEvidence: http.policyEvidence });
  if (option('output-dir')) {
    const directory = resolve(option('output-dir'));
    // Never overwrite an old discovery directory, checkpoint or plan.
    await mkdir(directory);
    await writeFile(resolve(directory, `${SOURCE}.json`), `${JSON.stringify(enumeration, null, 2)}\n`, { flag: 'wx' });
    report.transport_directory = directory;
    report.proposed_command = `node scripts/sweep-sources.mjs --source=${SOURCE} --enumeration-dir=${JSON.stringify(directory)}`;
    await writeFile(resolve(directory, 'reprocessing-plan.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  }
  const { targets, unmatched, ...summary } = report;
  console.log(JSON.stringify(summary, null, 2));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch(error => { console.error(error.message); process.exitCode = 1; });
