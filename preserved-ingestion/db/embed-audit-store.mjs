const mutableEmbedKeys = ['embed_status', 'embed_working', 'embed_url_if_allowed', 'embed_checked_at', 'embed_verification_evidence', 'watch_state', 'updated_at'];
const protectedSnapshot = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => !mutableEmbedKeys.includes(key)));
const sameSnapshot = (a, b) => JSON.stringify(Object.entries(protectedSnapshot(a)).sort(([a], [b]) => a.localeCompare(b))) === JSON.stringify(Object.entries(protectedSnapshot(b)).sort(([a], [b]) => a.localeCompare(b)));

export async function auditBaseline(client) {
  const rows = (await client.query(`SELECT
    (SELECT COUNT(*)::integer FROM work) AS works,
    (SELECT COUNT(*)::integer FROM playback_source) AS playback_sources,
    (SELECT COUNT(*)::integer FROM source_verification) AS source_verifications,
    (SELECT COUNT(*)::integer FROM ingest_candidate) AS ingest_candidates,
    (SELECT MD5(STRING_AGG(MD5(TO_JSONB(t)::text), '' ORDER BY work_id)) FROM work t) AS works_digest,
    (SELECT MD5(STRING_AGG(MD5(TO_JSONB(t)::text), '' ORDER BY verification_id)) FROM source_verification t) AS source_verifications_digest,
    (SELECT MD5(STRING_AGG(MD5(TO_JSONB(t)::text), '' ORDER BY candidate_id)) FROM ingest_candidate t) AS ingest_candidates_digest,
    (SELECT MD5(STRING_AGG(MD5(TO_JSONB(t)::text), '' ORDER BY run_id)) FROM ingest_run t) AS ingest_runs_digest,
    (SELECT MD5(STRING_AGG(MD5((TO_JSONB(t) - $1::text[])::text), '' ORDER BY source_id)) FROM playback_source t) AS protected_playback_digest`, [mutableEmbedKeys])).rows[0];
  return rows;
}

export async function createEmbedAuditRun(client, context = {}) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    const baseline = await auditBaseline(client);
    const run = (await client.query('INSERT INTO embed_audit_run (baseline,context) VALUES ($1,$2) RETURNING run_id', [JSON.stringify(baseline), JSON.stringify({ audit_version: 1, arbitrary_numerical_cap: null, ...context })])).rows[0];
    // Snapshot precisely the existing PASS + external cohort, not discovered candidates.
    await client.query(`INSERT INTO embed_audit_item (run_id,source_id,work_id,registry_source_id,source_snapshot)
      SELECT $1,p.source_id,p.work_id,p.registry_source_id,TO_JSONB(p) FROM playback_source p
      WHERE p.live_check_status='PASS' AND p.watch_state='WATCH_FREE_EXTERNALLY'`, [run.run_id]);
    await client.query('UPDATE embed_audit_run SET cohort_size=(SELECT COUNT(*) FROM embed_audit_item WHERE run_id=$1) WHERE run_id=$1', [run.run_id]);
    await client.query('COMMIT'); return run.run_id;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

export function verifiedPromotion(source, result, now = Date.now()) {
  const checked = Date.parse(source.last_checked_at || ''), embedChecked = Date.parse(result.checked_at || '');
  if (!(source.full_film_verified && source.free_verified && source.official_or_rights_verified && source.live_check_status === 'PASS'
    && ['VERIFIED', 'PUBLISHED'].includes(source.lifecycle_status) && source.external_watch_url && source.work_id
    && checked <= now && checked > now - 7 * 86400000 && embedChecked <= now && embedChecked > now - 7 * 86400000)) return false;
  if (source.availability_expiry_if_known && !(Date.parse(source.availability_expiry_if_known) > now)) return false;
  if (result.outcome !== 'WATCH_HERE' || result.permission_status !== 'VERIFIED' || result.technical_status !== 'VERIFIED'
    || result.embed_status !== 'PERMITTED' || result.embed_working !== true || !/^https:\/\//u.test(result.embed_url_if_allowed || '')) return false;
  const permission = result.evidence?.find((e) => e.kind === 'EMBED_PROJECT_PERMISSION' && e.value?.permitted === true && e.value?.usage_reviewed === true && e.value?.attribution_verified === true);
  const playback = result.evidence?.find((e) => e.kind === 'EMBED_BROWSER_PLAYBACK' && e.value?.played === true && e.value?.third_party_iframe === true
    && e.value?.provider_controls_preserved === true && e.value?.restrictions_bypassed === false && e.url === result.embed_url_if_allowed);
  const offer = result.evidence?.find((e) => e.kind === 'EMBED_PROVIDER_OFFER' && e.url === source.canonical_source_url
    && e.value?.observed_player_url === result.embed_url_if_allowed && e.value?.origin === 'PROVIDER_SHARE_TEMPLATE');
  const identity = result.evidence?.find((e) => e.kind === 'EMBED_PLAYER_CONFIG' && e.url === result.embed_url_if_allowed
    && e.value?.identity_matches === true && e.value?.full_film === true && e.value?.embed_mode === true
    && e.value?.provider_logo_and_share_enabled === true && e.value?.required_linkback_observed === true);
  if (!permission || !playback || !offer || !identity || !permission.value.origin || permission.value.origin !== playback.value.origin) return false;
  try {
    const origin = new URL(permission.value.origin), player = new URL(result.embed_url_if_allowed);
    return origin.protocol === 'https:' && origin.href === `${origin.origin}/` && origin.origin !== player.origin
      && player.protocol === 'https:' && !player.username && !player.password;
  } catch { return false; }
}

export async function persistEmbedAuditResult(client, runId, sourceId, input) {
  await client.query('BEGIN');
  try {
    const exists = await client.query('SELECT 1 FROM embed_audit_result WHERE run_id=$1 AND source_id=$2', [runId, sourceId]);
    if (exists.rowCount) { await client.query('COMMIT'); return false; }
    const item = (await client.query('SELECT * FROM embed_audit_item WHERE run_id=$1 AND source_id=$2', [runId, sourceId])).rows[0];
    if (!item) throw new Error('SOURCE_NOT_IN_EMBED_AUDIT_COHORT');
    const current = (await client.query('SELECT TO_JSONB(p) AS snapshot FROM playback_source p WHERE source_id=$1 FOR UPDATE', [sourceId])).rows[0]?.snapshot;
    const result = structuredClone(input);
    const unchanged = current && sameSnapshot(current, item.source_snapshot) && current.watch_state === item.source_snapshot.watch_state;
    if (!unchanged) {
      Object.assign(result, { outcome: 'MANUAL_REVIEW', permission_status: 'UNCERTAIN', technical_status: 'UNCONFIRMED', embed_status: 'UNKNOWN', embed_working: false, embed_url_if_allowed: null, error_code: 'SOURCE_CHANGED_SINCE_AUDIT_SNAPSHOT' });
      result.reason_codes.push('SOURCE_CHANGED_SINCE_AUDIT_SNAPSHOT');
    }
    const promote = unchanged && verifiedPromotion(current, result);
    if (result.outcome === 'WATCH_HERE' && !promote) throw new Error('EMBED_PROMOTION_REQUIRES_PROJECT_PERMISSION_AND_REAL_IFRAME_PLAYBACK_PROOF');
    const prohibited = result.outcome === 'PROHIBITED' && result.permission_status === 'PROHIBITED';
    if (result.outcome === 'PROHIBITED' && !prohibited) throw new Error('PROHIBITED_OUTCOME_REQUIRES_PERMISSION_EVIDENCE');
    await client.query(`INSERT INTO embed_audit_result (run_id,source_id,checked_at,outcome,permission_status,technical_status,reason_codes,error_code,evidence,applied)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [runId, sourceId, result.checked_at, result.outcome, result.permission_status, result.technical_status, JSON.stringify([...new Set(result.reason_codes)]), result.error_code || null, JSON.stringify(result.evidence), Boolean(unchanged)]);
    if (unchanged) {
      // Only embed fields/watch label change. Never rewrite health flags, health timestamps,
      // verification_evidence, external fallback, identities, metadata or source_verification.
      await client.query(`UPDATE playback_source SET embed_status=$2,embed_working=$3,embed_url_if_allowed=$4,
        watch_state=$5,embed_checked_at=$6,embed_verification_evidence=$7,updated_at=NOW() WHERE source_id=$1`,
      [sourceId, promote ? 'PERMITTED' : prohibited ? 'PROHIBITED' : 'UNKNOWN', promote, promote ? result.embed_url_if_allowed : null,
        promote ? 'WATCH_HERE' : 'WATCH_FREE_EXTERNALLY', result.checked_at, JSON.stringify(result.evidence)]);
    }
    await client.query('COMMIT'); return true;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

export async function embedAuditReport(client, runId) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const run = (await client.query('SELECT * FROM embed_audit_run WHERE run_id=$1', [runId])).rows[0];
    if (!run) throw new Error('UNKNOWN_EMBED_AUDIT_RUN');
    const counts = (await client.query(`SELECT COUNT(e.source_id)::integer AS sources_audited,
      COUNT(DISTINCT i.work_id) FILTER (WHERE e.source_id IS NOT NULL)::integer AS unique_films_audited,
      COUNT(*) FILTER (WHERE e.outcome='WATCH_HERE' AND p.watch_state='WATCH_HERE')::integer AS watch_here_source_records,
      COUNT(DISTINCT i.work_id) FILTER (WHERE e.outcome='WATCH_HERE' AND p.watch_state='WATCH_HERE')::integer AS unique_watch_here_films,
      COUNT(*) FILTER (WHERE p.watch_state='WATCH_FREE_EXTERNALLY')::integer AS watch_free_externally_remaining,
      COUNT(DISTINCT i.work_id) FILTER (WHERE p.watch_state='WATCH_FREE_EXTERNALLY')::integer AS unique_watch_free_externally_films,
      COUNT(*) FILTER (WHERE e.outcome='PROHIBITED')::integer AS prohibited_embeds,
      COUNT(*) FILTER (WHERE e.outcome='TECHNICALLY_DISABLED')::integer AS technically_disabled_embeds,
      COUNT(*) FILTER (WHERE e.outcome='MANUAL_REVIEW')::integer AS uncertain_manual_review_embeds,
      COUNT(*) FILTER (WHERE e.error_code IS NOT NULL)::integer AS sources_with_errors,
      COUNT(*) FILTER (WHERE e.source_id IS NULL)::integer AS pending,
      MIN(e.checked_at) AS first_embed_check,MAX(e.checked_at) AS last_embed_check
      FROM embed_audit_item i JOIN playback_source p USING (source_id) LEFT JOIN embed_audit_result e USING (run_id,source_id) WHERE i.run_id=$1`, [runId])).rows[0];
    const registry = (await client.query(`SELECT i.registry_source_id,COUNT(*)::integer AS cohort_sources,COUNT(DISTINCT i.work_id)::integer AS cohort_films,
      COUNT(e.source_id)::integer AS audited,COUNT(*) FILTER (WHERE e.outcome='WATCH_HERE')::integer AS watch_here,
      COUNT(DISTINCT i.work_id) FILTER (WHERE e.outcome='WATCH_HERE')::integer AS watch_here_films,
      COUNT(*) FILTER (WHERE p.watch_state='WATCH_FREE_EXTERNALLY')::integer AS external_remaining,
      COUNT(*) FILTER (WHERE e.outcome='PROHIBITED')::integer AS prohibited,
      COUNT(*) FILTER (WHERE e.outcome='TECHNICALLY_DISABLED')::integer AS technically_disabled,
      COUNT(*) FILTER (WHERE e.outcome='MANUAL_REVIEW')::integer AS manual_review,
      COUNT(*) FILTER (WHERE e.error_code IS NOT NULL)::integer AS errors,
      COUNT(*) FILTER (WHERE e.source_id IS NULL)::integer AS pending
      FROM embed_audit_item i JOIN playback_source p USING (source_id) LEFT JOIN embed_audit_result e USING (run_id,source_id) WHERE i.run_id=$1 GROUP BY 1 ORDER BY 1`, [runId])).rows;
    const reasons = (await client.query(`SELECT reason,COUNT(*)::integer AS sources FROM embed_audit_result e CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS_TEXT(e.reason_codes) reason WHERE run_id=$1 GROUP BY 1 ORDER BY 2 DESC,1`, [runId])).rows;
    const errors = (await client.query(`SELECT error_code,COUNT(*)::integer AS sources FROM embed_audit_result WHERE run_id=$1 AND error_code IS NOT NULL GROUP BY 1 ORDER BY 2 DESC,1`, [runId])).rows;
    const technical = (await client.query('SELECT technical_status,COUNT(*)::integer AS sources FROM embed_audit_result WHERE run_id=$1 GROUP BY 1 ORDER BY 2 DESC,1', [runId])).rows;
    const currentBaseline = await auditBaseline(client);
    const preserved = Object.entries(run.baseline).every(([key, value]) => currentBaseline[key] === value);
    const publicCounts = (await client.query(`SELECT COUNT(*)::integer AS sources,COUNT(DISTINCT work_id)::integer AS films,
      COUNT(*) FILTER (WHERE watch_state='WATCH_HERE')::integer AS watch_here_sources FROM public_watchable_sources`)).rows[0];
    await client.query('COMMIT');
    return { run_id: runId, status: run.status, started_at: run.started_at, finished_at: run.finished_at, generated_at: new Date().toISOString(),
      cohort_size: run.cohort_size, ...counts, registry, reasons, errors, technical_checks: technical, blocked_hosts: run.blocked_hosts,
      policies: run.policy_snapshot, context: run.context, preservation: { passed: preserved, baseline: run.baseline, current: currentBaseline }, public_eligibility: publicCounts,
      note: 'Audited means a persisted embed-only decision/attempt, not a claim every film is playable in a third-party browser. Manual review/error outcomes remain external-only. Reason counts overlap; outcomes do not.' };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
