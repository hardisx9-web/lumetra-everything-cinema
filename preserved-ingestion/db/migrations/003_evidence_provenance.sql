-- Different reports may reassert or change a source at the same checked_at timestamp.
-- Key imported evidence by the immutable report/run rather than its untrusted timestamp.
ALTER TABLE source_verification ADD COLUMN IF NOT EXISTS ingest_run_id UUID REFERENCES ingest_run(run_id);
DROP INDEX IF EXISTS source_verification_import_idx;
CREATE UNIQUE INDEX IF NOT EXISTS source_verification_run_idx ON source_verification (source_id, ingest_run_id) WHERE ingest_run_id IS NOT NULL;
UPDATE source_verification v SET ingest_run_id = (
  SELECT r.run_id FROM ingest_run r
  WHERE r.mode = CASE WHEN v.source_id LIKE 'legacy_%' THEN 'LEGACY_EDITORIAL' ELSE 'VERIFY_DETAILS' END
  ORDER BY r.created_at, r.run_id LIMIT 1
) WHERE v.verifier = 'legacy-report' AND v.ingest_run_id IS NULL
 AND v.verification_id = (SELECT MIN(old.verification_id) FROM source_verification old WHERE old.source_id=v.source_id AND old.verifier='legacy-report');
