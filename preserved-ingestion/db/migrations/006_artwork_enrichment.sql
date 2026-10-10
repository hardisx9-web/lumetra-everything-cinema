-- Additive, resumable artwork recovery metadata. Existing media_asset rows are preserved.
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS artwork_type TEXT NOT NULL DEFAULT 'POSTER';
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS source_page_url TEXT;
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS creator TEXT;
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS copyright_holder TEXT;
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS license_url TEXT;
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS match_confidence NUMERIC;
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS match_method TEXT;
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS match_status TEXT NOT NULL DEFAULT 'UNASSESSED';
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW';
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS image_width INTEGER;
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS image_height INTEGER;
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS image_sha256 TEXT;
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS health_status TEXT NOT NULL DEFAULT 'UNTESTED';
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS health_checked_at TIMESTAMPTZ;
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS verification_timestamp TIMESTAMPTZ;
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS artwork_language TEXT;
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS territory TEXT;
ALTER TABLE media_asset ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS media_asset_review_idx ON media_asset (review_status, health_status, asset_type);
CREATE INDEX IF NOT EXISTS media_asset_match_idx ON media_asset (match_status, match_confidence);
CREATE INDEX IF NOT EXISTS media_asset_hash_idx ON media_asset (image_sha256) WHERE image_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_asset_primary_idx ON media_asset (work_id, is_primary, review_status);

CREATE TABLE IF NOT EXISTS artwork_enrichment_run (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  batch_size INTEGER NOT NULL DEFAULT 25,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  checkpoint JSONB NOT NULL DEFAULT '{}'::JSONB,
  counts JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS artwork_enrichment_item (
  run_id UUID NOT NULL REFERENCES artwork_enrichment_run(run_id) ON DELETE CASCADE,
  work_id TEXT NOT NULL REFERENCES work(work_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  asset_id UUID REFERENCES media_asset(asset_id) ON DELETE SET NULL,
  provider TEXT,
  reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, work_id)
);
CREATE INDEX IF NOT EXISTS artwork_enrichment_item_status_idx ON artwork_enrichment_item (run_id, status, work_id);

COMMENT ON TABLE artwork_enrichment_run IS 'Resumable artwork discovery checkpoints; no source or artwork row is deleted by a run.';
COMMENT ON TABLE artwork_enrichment_item IS 'One immutable per-run decision per Work, including rejected and failed matches.';
