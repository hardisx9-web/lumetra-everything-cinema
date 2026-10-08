-- Preserve import identity and historical evidence separately from current eligibility.
ALTER TABLE ingest_run ADD COLUMN IF NOT EXISTS report_sha256 TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ingest_run_report_sha256_idx ON ingest_run (report_sha256);
ALTER TABLE playback_source ADD COLUMN IF NOT EXISTS historical_watch_state TEXT;
ALTER TABLE playback_source ADD COLUMN IF NOT EXISTS embed_working BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE playback_source ADD COLUMN IF NOT EXISTS match_review TEXT;
ALTER TABLE source_verification ADD COLUMN IF NOT EXISTS embed_working BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE source_verification ADD COLUMN IF NOT EXISTS availability_expiry TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS work_external_id (
  registry_source_id TEXT NOT NULL REFERENCES source_registry(source_id),
  external_id TEXT NOT NULL,
  work_id TEXT NOT NULL REFERENCES work(work_id),
  PRIMARY KEY (registry_source_id, external_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ingest_candidate_run_source_idx ON ingest_candidate (ingest_run_id, registry_source_id, source_url);
CREATE UNIQUE INDEX IF NOT EXISTS media_asset_work_url_idx ON media_asset (work_id, asset_type, canonical_url);
CREATE UNIQUE INDEX IF NOT EXISTS source_verification_import_idx ON source_verification (source_id, verifier, checked_at) WHERE verifier = 'legacy-report';
CREATE INDEX IF NOT EXISTS source_verification_latest_idx ON source_verification (source_id, checked_at DESC, verification_id DESC);
-- Latest verification must be independent, current and unexpired. An HTTP success alone is never qualifying evidence.
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
  OR (p.watch_state = 'WATCH_HERE' AND p.embed_status = 'PERMITTED' AND p.embed_working AND v.embed_working AND p.embed_url_if_allowed IS NOT NULL)
 );
