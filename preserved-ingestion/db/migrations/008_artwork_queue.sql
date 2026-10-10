-- Keep original ingestion fields unchanged. The first inventory classified imported
-- images into asset_type; restore that historical field (all 14,470 were POSTER).
-- Derived classifications remain in artwork_type and are unreviewed.
UPDATE media_asset SET asset_type='POSTER',match_confidence=NULL,
 match_status='SOURCE_RELATION_UNREVIEWED',match_method='IMPORTED_WORK_ID'
 WHERE usage_basis='SOURCE_IMAGE_LICENSE_UNVERIFIED' AND NOT license_verified;

ALTER TABLE artwork_enrichment_item ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 100;
ALTER TABLE artwork_enrichment_item ADD COLUMN IF NOT EXISTS input_snapshot JSONB;
CREATE TABLE IF NOT EXISTS artwork_candidate (
 candidate_key TEXT PRIMARY KEY,
 run_id UUID REFERENCES artwork_enrichment_run(run_id),
 work_id TEXT REFERENCES work(work_id),
 provider TEXT NOT NULL,
 source_page_url TEXT NOT NULL,
 decision TEXT NOT NULL,
 reason TEXT NOT NULL,
 evidence JSONB NOT NULL,
 checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS artwork_candidate_work ON artwork_candidate(work_id,decision);
CREATE TABLE IF NOT EXISTS artwork_provider_checkpoint (
 provider TEXT PRIMARY KEY,
 not_before TIMESTAMPTZ,
 reason TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
