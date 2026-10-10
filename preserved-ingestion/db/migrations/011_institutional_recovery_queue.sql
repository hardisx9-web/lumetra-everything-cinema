-- Resumable, non-destructive review of existing institutional asset rows.
-- A rights-blocked decision is persisted instead of silently disappearing.
CREATE TABLE IF NOT EXISTS artwork_institutional_recovery_item (
  run_id UUID NOT NULL REFERENCES artwork_enrichment_run(run_id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES media_asset(asset_id) ON DELETE CASCADE,
  work_id TEXT REFERENCES work(work_id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, asset_id)
);
CREATE INDEX IF NOT EXISTS artwork_institutional_recovery_status_idx ON artwork_institutional_recovery_item(run_id,status,provider);
