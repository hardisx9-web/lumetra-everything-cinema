-- Independent, resumable image loading observations. A failed URL is never silently published.
CREATE TABLE IF NOT EXISTS artwork_health_check (
  asset_id UUID PRIMARY KEY REFERENCES media_asset(asset_id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL,
  http_status INTEGER,
  content_type TEXT,
  error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB
);
CREATE INDEX IF NOT EXISTS artwork_health_status_idx ON artwork_health_check (status, checked_at);
