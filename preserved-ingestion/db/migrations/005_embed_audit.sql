-- Additive embed-only audit. Existing source/health/ingestion evidence is untouched.
ALTER TABLE playback_source ADD COLUMN IF NOT EXISTS embed_checked_at TIMESTAMPTZ;
ALTER TABLE playback_source ADD COLUMN IF NOT EXISTS embed_verification_evidence JSONB NOT NULL DEFAULT '[]'::JSONB;

CREATE TABLE IF NOT EXISTS embed_audit_run (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  cohort_size INTEGER NOT NULL DEFAULT 0,
  baseline JSONB NOT NULL DEFAULT '{}'::JSONB,
  policy_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  blocked_hosts JSONB NOT NULL DEFAULT '{}'::JSONB,
  context JSONB NOT NULL DEFAULT '{}'::JSONB
);
CREATE TABLE IF NOT EXISTS embed_audit_item (
  run_id UUID NOT NULL REFERENCES embed_audit_run(run_id),
  source_id TEXT NOT NULL REFERENCES playback_source(source_id),
  work_id TEXT,
  registry_source_id TEXT NOT NULL,
  source_snapshot JSONB NOT NULL,
  PRIMARY KEY (run_id, source_id)
);
CREATE TABLE IF NOT EXISTS embed_audit_result (
  run_id UUID NOT NULL,
  source_id TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('WATCH_HERE','PROHIBITED','TECHNICALLY_DISABLED','MANUAL_REVIEW')),
  permission_status TEXT NOT NULL,
  technical_status TEXT NOT NULL,
  reason_codes JSONB NOT NULL DEFAULT '[]'::JSONB,
  error_code TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::JSONB,
  applied BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (run_id, source_id),
  FOREIGN KEY (run_id, source_id) REFERENCES embed_audit_item(run_id, source_id)
);
CREATE INDEX IF NOT EXISTS embed_audit_result_source_idx ON embed_audit_result (source_id, checked_at DESC);
-- The independent health gate and its original timestamps/provenance remain intact.
-- A separate verified embed audit may supply embed proof; it never supplies health proof.
CREATE OR REPLACE VIEW public_watchable_sources AS
SELECT p.* FROM playback_source p
JOIN LATERAL (
  SELECT v.* FROM source_verification v WHERE v.source_id = p.source_id
  ORDER BY v.checked_at DESC, v.verification_id DESC LIMIT 1
) v ON TRUE
WHERE p.work_id IS NOT NULL
 AND p.full_film_verified AND p.free_verified AND p.official_or_rights_verified
 AND p.lifecycle_status IN ('VERIFIED','PUBLISHED')
 AND p.live_check_status = 'PASS'
 AND p.watch_state IN ('WATCH_HERE','WATCH_FREE_EXTERNALLY')
 AND p.last_checked_at = v.checked_at
 AND v.verifier = 'provider-health-check' AND v.live_check_status = 'PASS'
 AND v.full_film_verified AND v.free_verified AND v.official_or_rights_verified
 AND v.checked_at <= NOW() AND v.checked_at > NOW() - INTERVAL '7 days'
 AND (p.availability_expiry_if_known IS NULL OR p.availability_expiry_if_known > NOW())
 AND (v.availability_expiry IS NULL OR v.availability_expiry > NOW())
 AND (
  (p.watch_state = 'WATCH_FREE_EXTERNALLY' AND p.external_watch_url IS NOT NULL)
  OR (p.watch_state = 'WATCH_HERE' AND p.embed_status = 'PERMITTED' AND p.embed_working AND p.embed_url_if_allowed IS NOT NULL
    AND (v.embed_working OR EXISTS (
      SELECT 1 FROM embed_audit_result e JOIN embed_audit_item i USING (run_id, source_id)
      WHERE e.source_id=p.source_id AND e.applied AND e.outcome='WATCH_HERE'
        AND e.permission_status='VERIFIED' AND e.technical_status='VERIFIED'
        AND e.checked_at=p.embed_checked_at AND e.checked_at <= NOW()
        AND e.checked_at > NOW() - INTERVAL '7 days'
        AND (i.source_snapshot->>'last_checked_at')::TIMESTAMPTZ=p.last_checked_at
    )))
 );
