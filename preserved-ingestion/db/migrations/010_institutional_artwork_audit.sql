-- Persist the provider-by-provider rights decision separately from each asset.
-- This never promotes an image; it explains why a source URL is or is not
-- eligible for the existing approved-artwork publication gate.
CREATE TABLE IF NOT EXISTS artwork_provider_policy (
  provider TEXT PRIMARY KEY,
  policy_status TEXT NOT NULL,
  can_republish BOOLEAN NOT NULL DEFAULT FALSE,
  attribution_required BOOLEAN NOT NULL DEFAULT TRUE,
  source_url TEXT NOT NULL,
  rights_basis TEXT NOT NULL,
  technical_notes TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
