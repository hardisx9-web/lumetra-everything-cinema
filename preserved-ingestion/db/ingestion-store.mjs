import { createHash } from 'node:crypto';
import { normalize, resolveWork, snapshotHash } from './entity-resolution.mjs';

// Use a connected, idle pg.Client (not Pool.query). Each call owns and commits its
// transaction. Persist enumeration first; resume with the saved run ID and exact
// snapshots. A different observation belongs to a new run, never an old report.
const busy = new WeakSet();
const fail = (message, code = 'INGESTION_STATE') => Object.assign(new Error(message), { code });
const json = (value) => JSON.parse(JSON.stringify(value));
const sourceIdOf = (source) => typeof source === 'string' ? source : source?.id || source?.registry_source_id || source?.source_id;
const requireText = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw fail(`${name} is required`, 'INGESTION_INPUT');
  return value.trim();
};
const requireUrl = (value, name) => {
  requireText(value, name);
  let url;
  try { url = new URL(value); } catch { throw fail(`${name} must be an absolute HTTP(S) URL`, 'INGESTION_INPUT'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw fail(`${name} must be a credential-free HTTP(S) URL`, 'INGESTION_INPUT');
  return value;
};
const date = (value, name) => {
  if (value == null) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw fail(`${name} must be a valid timestamp`, 'INGESTION_INPUT');
  return parsed;
};
const runtimeOf = (value) => value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const yearOf = (value) => Number.isInteger(Number(value)) && Number(value) >= 1880 && Number(value) <= 2200 ? Number(value) : null;
const historicalRun = (run) => /HISTORICAL|LEGACY|IMPORT/i.test(run.mode) || run.status === 'HISTORICAL_IMPORT';
const registrySources = (registry) => Array.isArray(registry) ? registry : [...(registry?.sources || []), ...(registry?.rights_holder_channels_to_enumerate || [])];
function terminalSummary(summary) {
  const snapshot = json(summary);
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw fail('summary must be an object', 'INGESTION_INPUT');
  if (snapshot.status != null && requireText(snapshot.status, 'summary status').toUpperCase() === 'RUNNING') throw fail('finish requires a terminal status', 'INGESTION_INPUT');
  return snapshot;
}
export const stableSourceId = (registrySourceId, sourceUrl) => `source_${registrySourceId}_${createHash('sha256').update(sourceUrl).digest('hex').slice(0, 16)}`;

async function transaction(client, action) {
  if (!client || typeof client.query !== 'function') throw fail('a connected pg.Client is required', 'INGESTION_INPUT');
  if (busy.has(client)) throw fail('do not overlap persistence calls on the same client');
  busy.add(client);
  let begun = false;
  try {
    await client.query('BEGIN'); begun = true;
    const result = await action();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (begun) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { busy.delete(client); }
}
async function lockRun(client, runId) {
  const run = (await client.query('SELECT * FROM ingest_run WHERE run_id=$1 FOR UPDATE', [runId])).rows[0];
  if (!run || run.store_version !== 1) throw fail('run is not an ingestion-store run; historical reports cannot be changed');
  return run;
}
function ensureOpen(run, group) {
  if (run.finished_at || run.status !== 'RUNNING') throw fail('run is already finished; use a new run for new observations');
  if (group?.finished_at) throw fail('source is already finished; use a new run for new observations');
}
async function assetAfterIdentity(client, runId, candidate, workId) {
  if (!workId || !candidate.poster_url) return;
  requireUrl(candidate.poster_url, 'poster_url');
  await client.query(`INSERT INTO media_asset (work_id,asset_type,canonical_url,usage_basis,license_verified,source_id,metadata)
    VALUES ($1,'POSTER',$2,'SOURCE_IMAGE_LICENSE_UNVERIFIED',FALSE,$3,$4::jsonb) ON CONFLICT DO NOTHING`,
  [workId, candidate.poster_url, candidate.registry_source_id, JSON.stringify({ ingest_run_id: runId, external_id: candidate.external_id ?? null })]);
}
async function groupCounts(client, runId, sourceId) {
  const row = (await client.query(`SELECT COUNT(*)::integer AS candidates,
    COUNT(*) FILTER (WHERE c.work_id IS NOT NULL)::integer AS resolved,
    COUNT(*) FILTER (WHERE c.match_review IS NOT NULL)::integer AS reviews,
    COUNT(v.verification_id)::integer AS verified,
    COUNT(*) FILTER (WHERE v.live_check_status='PASS' AND v.verifier='provider-health-check')::integer AS provider_passes
    FROM ingest_candidate c LEFT JOIN source_verification v ON v.candidate_id=c.candidate_id AND v.ingest_run_id=c.ingest_run_id
    WHERE c.ingest_run_id=$1 AND c.registry_source_id=$2`, [runId, sourceId])).rows[0];
  return row;
}

export async function createRun(client, { registry, mode = 'SOURCE_SWEEP' } = {}) {
  const snapshot = json(registry ?? {});
  const sources = registrySources(snapshot);
  if (!sources.length) throw fail('registry must contain sources', 'INGESTION_INPUT');
  requireText(mode, 'mode');
  const seen = new Set();
  for (const source of sources) {
    const id = requireText(source.id, 'registry source id');
    if (seen.has(id)) throw fail(`duplicate registry source ${id}`, 'INGESTION_INPUT');
    seen.add(id);
    requireText(source.name, 'registry source name'); requireUrl(source.official_url, 'registry official_url');
  }
  return transaction(client, async () => {
    for (const source of [...sources].sort((left, right) => left.id.localeCompare(right.id))) await client.query(`INSERT INTO source_registry (source_id,name,official_url,region,source_type,status,priority,free,embed_policy,default_watch_state,source_json)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
      ON CONFLICT (source_id) DO UPDATE SET name=EXCLUDED.name,official_url=EXCLUDED.official_url,region=EXCLUDED.region,source_type=EXCLUDED.source_type,
      status=EXCLUDED.status,priority=EXCLUDED.priority,free=EXCLUDED.free,embed_policy=EXCLUDED.embed_policy,default_watch_state=EXCLUDED.default_watch_state,source_json=EXCLUDED.source_json,updated_at=NOW()`,
    [source.id, source.name, source.official_url, source.region || null, source.type || null, source.status || 'UNKNOWN', source.priority || null, source.free === true, source.embed_policy || null, source.default_watch_state || null, JSON.stringify(source)]);
    const run = await client.query(`INSERT INTO ingest_run (registry_version,mode,started_at,registry_snapshot,store_version)
      VALUES ($1,$2,clock_timestamp(),$3::jsonb,1) RETURNING run_id`, [snapshot.registry_meta?.version || snapshot.version || null, mode, JSON.stringify(snapshot)]);
    return run.rows[0].run_id;
  });
}

export async function persistEnumeration(client, runId, source, result) {
  const sourceId = requireText(sourceIdOf(source), 'source id');
  const snapshot = json(result);
  if (!snapshot || !Array.isArray(snapshot.candidates)) throw fail('enumeration result.candidates must be an array', 'INGESTION_INPUT');
  requireText(snapshot.status, 'enumeration status');
  if (typeof snapshot.enumeration_complete !== 'boolean') throw fail('enumeration_complete must be explicit', 'INGESTION_INPUT');
  if (snapshot.requests != null && !Array.isArray(snapshot.requests)) throw fail('requests must be a redacted array', 'INGESTION_INPUT');
  const seen = new Set();
  for (const candidate of snapshot.candidates) {
    if (candidate.registry_source_id !== sourceId) throw fail('candidate registry_source_id differs from source', 'INGESTION_INPUT');
    requireUrl(candidate.source_url, 'candidate source_url');
    if (seen.has(candidate.source_url)) throw fail('duplicate source URL in enumeration snapshot', 'INGESTION_INPUT');
    seen.add(candidate.source_url);
  }
  const digest = snapshotHash(snapshot);
  return transaction(client, async () => {
    const run = await lockRun(client, runId);
    if (!registrySources(run.registry_snapshot).some((item) => item.id === sourceId)) throw fail('source is not in this run registry', 'INGESTION_INPUT');
    const prior = (await client.query('SELECT * FROM ingest_source_result WHERE ingest_run_id=$1 AND registry_source_id=$2', [runId, sourceId])).rows[0];
    if (prior) {
      if (prior.result_sha256 !== digest) throw fail('enumeration snapshot differs from the persisted observation; start a new run', 'INGESTION_CONFLICT');
      return { runId, sourceId, candidates: prior.candidate_count, enumerationComplete: prior.enumeration_complete, status: prior.status, skipped: true };
    }
    ensureOpen(run);
    await client.query(`INSERT INTO ingest_source_result (ingest_run_id,registry_source_id,enumeration_status,enumeration_complete,blocker,requests,candidate_count,result_sha256,result_json,status)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$3)`,
    [runId, sourceId, snapshot.status, snapshot.enumeration_complete, snapshot.blocker == null ? null : typeof snapshot.blocker === 'string' ? snapshot.blocker : JSON.stringify(snapshot.blocker), JSON.stringify(snapshot.requests || []), snapshot.candidates.length, digest, JSON.stringify(snapshot)]);
    for (const candidate of snapshot.candidates) {
      const inserted = await client.query(`INSERT INTO ingest_candidate (ingest_run_id,registry_source_id,external_id,source_url,title,normalized_title,year,director,runtime,poster_url,parser_id,candidate_json,snapshot_sha256)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13) RETURNING candidate_id`,
      [runId, sourceId, candidate.external_id == null ? null : String(candidate.external_id), candidate.source_url, candidate.title || candidate.display_title || null, normalize(candidate.title || candidate.display_title || ''), yearOf(candidate.year), candidate.director_credit || null, runtimeOf(candidate.runtime), candidate.poster_url || null, candidate.parser || null, JSON.stringify(candidate), snapshotHash(candidate)]);
      const candidateId = inserted.rows[0].candidate_id;
      const resolved = await resolveWork(client, { registry_source_id: sourceId, canonical_source_url: candidate.source_url, runtime: candidate.runtime, metadata: candidate, ingest_run_id: runId, candidate_id: candidateId, resolution_stage: 'enumeration' });
      await client.query(`UPDATE ingest_candidate SET work_id=$2,match_review=$3,resolution_json=$4::jsonb,candidate_status=$5 WHERE candidate_id=$1`,
      [candidateId, resolved.workId, resolved.review, JSON.stringify(resolved.evidence), resolved.review ? 'REVIEW' : 'RESOLVED']);
      await assetAfterIdentity(client, runId, candidate, resolved.workId);
    }
    return { runId, sourceId, candidates: snapshot.candidates.length, enumerationComplete: snapshot.enumeration_complete, status: snapshot.status, skipped: false };
  });
}

export async function persistVerification(client, runId, source, candidate, record) {
  const sourceId = requireText(sourceIdOf(source), 'source id');
  const candidateSnapshot = json(candidate);
  if (candidateSnapshot.registry_source_id !== sourceId || record?.registry_source_id !== sourceId) throw fail('verification source IDs differ from enumeration', 'INGESTION_INPUT');
  requireUrl(candidateSnapshot.source_url, 'candidate source_url');
  if (record.canonical_source_url !== candidateSnapshot.source_url) throw fail('record URL must match the enumerated source URL', 'INGESTION_INPUT');
  const snapshot = json({ ...record, metadata: { ...candidateSnapshot, ...(record.metadata || {}), registry_source_id: sourceId, source_url: candidateSnapshot.source_url } });
  const digest = snapshotHash(snapshot);
  const evidence = snapshot.verification_evidence || [];
  if (!Array.isArray(evidence) || evidence.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) throw fail('verification_evidence must be structured evidence objects', 'INGESTION_INPUT');
  if (snapshot.live_check_status === 'PASS' && (!evidence.length || !snapshot.last_checked_at)) throw fail('provider PASS requires structured evidence and last_checked_at', 'INGESTION_INPUT');
  const checkedAt = date(snapshot.last_checked_at, 'last_checked_at') || new Date();
  const firstVerified = date(snapshot.first_verified_at, 'first_verified_at');
  const expiry = date(snapshot.availability_expiry_if_known, 'availability_expiry_if_known');
  for (const name of ['territories', 'audio_languages', 'subtitle_languages']) if (snapshot[name] != null && !Array.isArray(snapshot[name])) throw fail(`${name} must be an array`, 'INGESTION_INPUT');
  for (const name of ['embed_url_if_allowed', 'external_watch_url']) if (snapshot[name]) requireUrl(snapshot[name], name);
  return transaction(client, async () => {
    const run = await lockRun(client, runId);
    const group = (await client.query('SELECT * FROM ingest_source_result WHERE ingest_run_id=$1 AND registry_source_id=$2', [runId, sourceId])).rows[0];
    if (!group) throw fail('persistEnumeration must commit before detail verification');
    const staged = (await client.query('SELECT * FROM ingest_candidate WHERE ingest_run_id=$1 AND registry_source_id=$2 AND source_url=$3', [runId, sourceId, candidateSnapshot.source_url])).rows[0];
    if (!staged || staged.snapshot_sha256 !== snapshotHash(candidateSnapshot)) throw fail('candidate does not match its immutable enumeration snapshot', 'INGESTION_CONFLICT');
    const priorVerification = (await client.query('SELECT * FROM source_verification WHERE ingest_run_id=$1 AND candidate_id=$2', [runId, staged.candidate_id])).rows[0];
    if (priorVerification) {
      if (priorVerification.record_sha256 !== digest) throw fail('verification snapshot differs from the persisted observation; start a new run', 'INGESTION_CONFLICT');
      const current = (await client.query('SELECT work_id,match_review FROM playback_source WHERE source_id=$1', [priorVerification.source_id])).rows[0];
      return { runId, sourceId: priorVerification.source_id, candidateId: staged.candidate_id, verificationId: priorVerification.verification_id, workId: staged.work_id || current.work_id, review: staged.match_review, currentUpdated: false, skipped: true };
    }
    ensureOpen(run, group);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['global-cinema-entity-resolution']);
    const sources = (await client.query('SELECT * FROM playback_source WHERE registry_source_id=$1 AND canonical_source_url=$2 ORDER BY created_at,source_id FOR UPDATE', [sourceId, candidateSnapshot.source_url])).rows;
    if (sources.length > 1) throw fail('historical source URL has multiple playback identities; manual review is required', 'INGESTION_CONFLICT');
    let current = sources[0];
    const playbackId = current?.source_id || snapshot.source_id || stableSourceId(sourceId, candidateSnapshot.source_url);
    requireText(playbackId, 'source_id');
    const collision = (await client.query('SELECT registry_source_id,canonical_source_url FROM playback_source WHERE source_id=$1', [playbackId])).rows[0];
    if (collision && (collision.registry_source_id !== sourceId || collision.canonical_source_url !== candidateSnapshot.source_url)) throw fail('source_id belongs to another source URL', 'INGESTION_CONFLICT');
    const resolved = await resolveWork(client, { ...snapshot, ingest_run_id: runId, candidate_id: staged.candidate_id, resolution_stage: 'verification' });
    const historical = historicalRun(run) || snapshot.verifier === 'legacy-report';
    const verifier = historical ? 'legacy-report' : 'provider-health-check';
    const full = snapshot.full_film_verified === true, free = snapshot.free_verified === true, official = snapshot.official_or_rights_verified === true;
    const expired = expiry && expiry <= new Date();
    const live = historical ? 'PENDING' : expired ? 'FAIL' : snapshot.live_check_status || 'PENDING';
    const eligible = !historical && !resolved.review && resolved.workId && full && free && official && live === 'PASS';
    const embedWorking = snapshot.embed_working === true;
    const embedStatus = snapshot.embed_status || 'UNKNOWN';
    let watch = 'NO_VERIFIED_FREE_STREAM';
    if (eligible && snapshot.watch_state === 'WATCH_HERE' && embedStatus === 'PERMITTED' && embedWorking && snapshot.embed_url_if_allowed) watch = 'WATCH_HERE';
    else if (eligible && ['WATCH_HERE', 'WATCH_FREE_EXTERNALLY'].includes(snapshot.watch_state) && snapshot.external_watch_url) watch = 'WATCH_FREE_EXTERNALLY';
    const lifecycle = expired || live === 'FAIL' ? 'EXPIRED' : eligible && watch !== 'NO_VERIFIED_FREE_STREAM' ? 'VERIFIED' : 'REVIEW';
    const owner = snapshot.source_owner || (await client.query('SELECT name FROM source_registry WHERE source_id=$1', [sourceId])).rows[0].name;
    if (!current) {
      current = (await client.query(`INSERT INTO playback_source (source_id,work_id,registry_source_id,source_owner,canonical_source_url,embed_status,metadata,match_review,historical_watch_state)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING *`,
      [playbackId, resolved.workId, sourceId, owner, candidateSnapshot.source_url, embedStatus, JSON.stringify(snapshot.metadata), resolved.review, historical ? snapshot.watch_state || null : null])).rows[0];
    }
    const inserted = await client.query(`INSERT INTO source_verification (source_id,checked_at,full_film_verified,free_verified,official_or_rights_verified,live_check_status,embed_status,watch_state,http_status,evidence,error_code,verifier,embed_working,availability_expiry,ingest_run_id,candidate_id,record_sha256,record_json)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18::jsonb) RETURNING verification_id`,
    [playbackId, checkedAt, full, free, official, snapshot.live_check_status || 'PENDING', embedStatus, snapshot.watch_state || 'NO_VERIFIED_FREE_STREAM', snapshot.http_status ?? null, JSON.stringify(evidence), snapshot.error_code || snapshot.rejection_reason || null, verifier, embedWorking, expiry, runId, staged.candidate_id, digest, JSON.stringify(snapshot)]);
    const verificationId = inserted.rows[0].verification_id;
    const latest = (await client.query('SELECT verification_id FROM source_verification WHERE source_id=$1 ORDER BY checked_at DESC,verification_id DESC LIMIT 1', [playbackId])).rows[0];
    const currentUpdated = !historical && latest.verification_id === verificationId && (!current.last_checked_at || checkedAt >= current.last_checked_at);
    if (currentUpdated) await client.query(`UPDATE playback_source SET work_id=COALESCE($2,work_id),source_owner=$3,
      full_film_verified=$4,free_verified=$5,official_or_rights_verified=$6,embed_status=$7,embed_working=$8,embed_url_if_allowed=$9,external_watch_url=$10,
      territories=$11::jsonb,audio_languages=$12::jsonb,subtitle_languages=$13::jsonb,version_or_restoration=$14,runtime=$15,
      first_verified_at=CASE WHEN $16::timestamptz IS NULL THEN first_verified_at WHEN first_verified_at IS NULL THEN $16::timestamptz ELSE LEAST(first_verified_at,$16::timestamptz) END,
      last_checked_at=$17,verification_evidence=$18::jsonb,availability_expiry_if_known=$19,live_check_status=$20,lifecycle_status=$21,watch_state=$22,
      adapter_id=$23,metadata=$24::jsonb,match_review=$25,updated_at=clock_timestamp() WHERE source_id=$1`,
    [playbackId, resolved.workId, owner, full, free, official, embedStatus, embedWorking, snapshot.embed_url_if_allowed || null, snapshot.external_watch_url || null,
      JSON.stringify(snapshot.territories || []), JSON.stringify(snapshot.audio_languages || []), JSON.stringify(snapshot.subtitle_languages || []), snapshot.version_or_restoration || null, runtimeOf(snapshot.runtime ?? snapshot.metadata.runtime),
      firstVerified || (eligible ? checkedAt : null), checkedAt, JSON.stringify(evidence), expiry, live, lifecycle, watch, snapshot.adapter_id || candidateSnapshot.parser || null, JSON.stringify(snapshot.metadata), resolved.review]);
    else if (!current.work_id && resolved.workId) await client.query('UPDATE playback_source SET work_id=$2 WHERE source_id=$1 AND work_id IS NULL', [playbackId, resolved.workId]);
    await client.query(`UPDATE ingest_candidate SET work_id=$2,match_review=$3,resolution_json=$4::jsonb,candidate_status=$5 WHERE candidate_id=$1`,
    [staged.candidate_id, resolved.workId, resolved.review, JSON.stringify(resolved.evidence), resolved.review ? 'REVIEW' : historical ? 'HISTORICAL' : lifecycle]);
    await assetAfterIdentity(client, runId, snapshot.metadata, resolved.workId);
    return { runId, sourceId: playbackId, candidateId: staged.candidate_id, verificationId, workId: resolved.workId || current.work_id, review: resolved.review, currentUpdated, skipped: false };
  });
}

export async function finishSource(client, runId, sourceId, summary = {}) {
  sourceId = requireText(sourceIdOf(sourceId), 'source id');
  const snapshot = terminalSummary(summary);
  return transaction(client, async () => {
    const run = await lockRun(client, runId);
    const group = (await client.query('SELECT * FROM ingest_source_result WHERE ingest_run_id=$1 AND registry_source_id=$2', [runId, sourceId])).rows[0];
    if (!group) throw fail('cannot finish a source before enumeration is persisted');
    if (group.finished_at) {
      if (snapshotHash(group.summary_json) !== snapshotHash(snapshot)) throw fail('finished source summary cannot be changed', 'INGESTION_CONFLICT');
      return { runId, sourceId, status: group.status, counts: await groupCounts(client, runId, sourceId), skipped: true };
    }
    ensureOpen(run);
    const counts = await groupCounts(client, runId, sourceId);
    const complete = group.enumeration_complete && counts.verified === counts.candidates;
    const status = snapshot.status || (complete ? 'COMPLETED' : group.enumeration_complete ? 'PARTIAL' : group.enumeration_status);
    if (status === 'COMPLETED' && !complete) throw fail('source cannot complete with incomplete enumeration or unchecked candidates');
    await client.query('UPDATE ingest_source_result SET status=$3,summary_json=$4::jsonb,finished_at=clock_timestamp() WHERE ingest_run_id=$1 AND registry_source_id=$2', [runId, sourceId, status, JSON.stringify(snapshot)]);
    return { runId, sourceId, status, counts, skipped: false };
  });
}

export async function finishRun(client, runId, summary = {}) {
  const snapshot = terminalSummary(summary);
  return transaction(client, async () => {
    const run = await lockRun(client, runId);
    if (run.finished_at) {
      if (snapshotHash(run.summary_json) !== snapshotHash(snapshot)) throw fail('finished run summary cannot be changed', 'INGESTION_CONFLICT');
      return { runId, status: run.status, counts: run.counts, skipped: true };
    }
    ensureOpen(run);
    const groups = (await client.query('SELECT * FROM ingest_source_result WHERE ingest_run_id=$1', [runId])).rows;
    const sourceCounts = await Promise.all(groups.map((group) => groupCounts(client, runId, group.registry_source_id)));
    const counts = { registered_sources: registrySources(run.registry_snapshot).length, enumerated_sources: groups.length, finished_sources: groups.filter((group) => group.finished_at).length,
      enumeration_complete_sources: groups.filter((group) => group.enumeration_complete).length, candidates: 0, resolved: 0, reviews: 0, verified: 0, provider_passes: 0 };
    for (const group of sourceCounts) for (const key of ['candidates', 'resolved', 'reviews', 'verified', 'provider_passes']) counts[key] += group[key];
    const complete = counts.registered_sources === counts.finished_sources && counts.enumeration_complete_sources === counts.registered_sources && counts.verified === counts.candidates;
    const status = historicalRun(run) ? 'HISTORICAL_IMPORT' : snapshot.status || (complete ? 'COMPLETED' : 'PARTIAL');
    if (status === 'COMPLETED' && !complete) throw fail('run cannot complete with missing/unfinished sources or unchecked candidates');
    await client.query('UPDATE ingest_run SET status=$2,finished_at=clock_timestamp(),counts=$3::jsonb,summary_json=$4::jsonb WHERE run_id=$1', [runId, status, JSON.stringify(counts), JSON.stringify(snapshot)]);
    return { runId, status, counts, skipped: false };
  });
}
