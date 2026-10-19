import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { EmbedHttp, auditNfbPolicy, auditEmbedSource } from '../lib/ingestion/embed-audit.mjs';
import { createEmbedAuditRun, persistEmbedAuditResult, embedAuditReport } from '../db/embed-audit-store.mjs';

const option = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const resume = option('resume'), reportOnly = process.argv.includes('--report-only'), newRun = process.argv.includes('--new-run');
const known = /^(?:--resume=.+|--output=.+|--report-only|--new-run)$/u;
if (!process.env.DATABASE_URL || process.argv.slice(2).some((a) => !known.test(a)) || (resume && newRun)) {
  console.error('DATABASE_URL required. Options: --resume=<UUID>, --report-only, --output=<JSON>, --new-run. No source-count cap or discovery option exists.'); process.exit(2);
}
const concurrency = Number(process.env.EMBED_AUDIT_CONCURRENCY || 4);
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('EMBED_AUDIT_CONCURRENCY must be 1..8 (workers, not a source cap)');
const output = resolve(option('output') || '.research/embed-audit-report.json');
const checkpoint = resolve('.research/embed-audit-checkpoint.json');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: 'global-cinema-embed-audit' });
let runId, stop = false, writes = Promise.resolve(), http;
process.on('SIGINT', () => { stop = true; }); process.on('SIGTERM', () => { stop = true; });
const commit = (fn) => { const next = writes.then(fn); writes = next; return next; };
async function atomicJson(path, value) { await mkdir(dirname(path), { recursive: true }); const tmp = `${path}.${process.pid}.tmp`; await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`); await rename(tmp, path); }
async function report() { const data = await embedAuditReport(client, runId); await atomicJson(output, data); return data; }
try {
  await client.connect();
  if (!reportOnly) {
    const locked = (await client.query("SELECT pg_try_advisory_lock(hashtext('global-cinema-embed-audit')) AS acquired")).rows[0].acquired;
    if (!locked) throw new Error('An embed audit is already running. Do not launch a competing audit.');
  }
  let run;
  if (resume) run = (await client.query('SELECT * FROM embed_audit_run WHERE run_id=$1', [resume])).rows[0];
  else if (!newRun) run = (await client.query('SELECT * FROM embed_audit_run ORDER BY started_at DESC LIMIT 1')).rows[0];
  if (resume && !run) throw new Error('Unknown embed audit checkpoint');
  if (!run && reportOnly) throw new Error('No existing embed audit to report');
  if (!run) {
    runId = await createEmbedAuditRun(client, { project_permission: 'NOT_APPROVED', project_origin: 'NOT_CONFIRMED', browser_playback_verifier: 'UNAVAILABLE', provider_branding: 'DO_NOT_MODIFY', film_downloads: 'NEVER', health_data: 'PRESERVED_NOT_RECHECKED' });
    run = (await client.query('SELECT * FROM embed_audit_run WHERE run_id=$1', [runId])).rows[0];
  } else runId = run.run_id;
  console.log(JSON.stringify({ run_id: runId, cohort_size: run.cohort_size, status: run.status, concurrency, resume_command: `node scripts/audit-embeds.mjs --resume=${runId}`, source_sweep: 'NOT_RUN' }));
  if (reportOnly || run.finished_at) {
    const data = await report(); console.log(JSON.stringify({ run_id: runId, status: data.status, sources_audited: data.sources_audited, pending: data.pending, report: output, skipped_completed_run: Boolean(run.finished_at) }));
  } else {
    await atomicJson(checkpoint, { run_id: runId, cohort_size: run.cohort_size, resume_command: `node scripts/audit-embeds.mjs --resume=${runId}`, report: output, started_at: run.started_at });
    http = new EmbedHttp({ blockedHosts: run.blocked_hosts });
    const policies = { ...run.policy_snapshot };
    const registries = (await client.query('SELECT DISTINCT registry_source_id FROM embed_audit_item WHERE run_id=$1', [runId])).rows;
    for (const { registry_source_id: id } of registries) {
      if (!policies[id]) policies[id] = id === 'nfb_canada' ? await auditNfbPolicy(http) : { provider: id, permission_status: 'UNCERTAIN', reason_codes: ['PROVIDER_EMBED_PERMISSION_ADAPTER_UNAVAILABLE'], evidence: [] };
    }
    await client.query("UPDATE embed_audit_run SET policy_snapshot=$2,blocked_hosts=$3,status='RUNNING' WHERE run_id=$1", [runId, JSON.stringify(policies), JSON.stringify(http.blockedHosts)]);
    const pending = (await client.query(`SELECT i.source_id,i.source_snapshot FROM embed_audit_item i LEFT JOIN embed_audit_result e USING (run_id,source_id)
      WHERE i.run_id=$1 AND e.source_id IS NULL ORDER BY i.registry_source_id,i.source_id`, [runId])).rows;
    let cursor = 0, saved = 0, failure;
    const startingAudited = run.cohort_size - pending.length;
    await report();
    async function worker() {
      while (!stop && !failure) {
        const item = pending[cursor++]; if (!item) return;
        try {
          const result = await auditEmbedSource(item.source_snapshot, http, policies[item.source_snapshot.registry_source_id]);
          await commit(async () => {
            await persistEmbedAuditResult(client, runId, item.source_id, result);
            await client.query('UPDATE embed_audit_run SET blocked_hosts=$2 WHERE run_id=$1', [runId, JSON.stringify(http.blockedHosts)]);
            saved++;
            if (saved % 250 === 0) {
              const data = await report();
              console.log(JSON.stringify({ run_id: runId, stage: 'embed-checkpoint', sources_audited: data.sources_audited, pending: data.pending, watch_here: data.watch_here_source_records, manual_review: data.uncertain_manual_review_embeds, technically_disabled: data.technically_disabled_embeds, errors: data.sources_with_errors }));
            }
          });
        } catch (error) { failure = error; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
    if (failure) throw failure;
    const remaining = pending.length - saved;
    await client.query('UPDATE embed_audit_run SET status=$2,finished_at=CASE WHEN $3 THEN NOW() ELSE NULL END,blocked_hosts=$4 WHERE run_id=$1', [runId, remaining ? 'INTERRUPTED' : 'COMPLETED', remaining === 0, JSON.stringify(http.blockedHosts)]);
    const data = await report();
    console.log(JSON.stringify({ run_id: runId, status: data.status, sources_audited: data.sources_audited, unique_films_audited: data.unique_films_audited,
      watch_here_source_records: data.watch_here_source_records, unique_watch_here_films: data.unique_watch_here_films, watch_free_externally_remaining: data.watch_free_externally_remaining,
      prohibited_embeds: data.prohibited_embeds, technically_disabled_embeds: data.technically_disabled_embeds, uncertain_manual_review_embeds: data.uncertain_manual_review_embeds,
      sources_with_errors: data.sources_with_errors, pending: data.pending, network_requests_this_process: http.requests, previously_audited: startingAudited, preservation_passed: data.preservation.passed, report: output }));
    if (!data.preservation.passed) throw new Error('Protected-data preservation comparison changed; inspect report before further writes');
  }
} catch (error) {
  if (runId && !reportOnly) {
    await client.query("UPDATE embed_audit_run SET status='INTERRUPTED',blocked_hosts=COALESCE($2::jsonb,blocked_hosts) WHERE run_id=$1 AND finished_at IS NULL", [runId, http ? JSON.stringify(http.blockedHosts) : null]).catch(() => {});
  }
  console.error(JSON.stringify({ run_id: runId || null, error: error.message, code: error.code || null, existing_data_not_reset: true,
    resume_command: runId ? `node scripts/audit-embeds.mjs --resume=${runId}` : null })); process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
