CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS source_registry (
  source_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  official_url TEXT NOT NULL,
  region TEXT,
  source_type TEXT,
  status TEXT NOT NULL,
  priority TEXT,
  free BOOLEAN NOT NULL DEFAULT FALSE,
  embed_policy TEXT,
  default_watch_state TEXT,
  source_json JSONB NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingest_run (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_version TEXT,
  mode TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  counts JSONB NOT NULL DEFAULT '{}'::JSONB,
  report_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work (
  work_id TEXT PRIMARY KEY,
  stable_key TEXT NOT NULL UNIQUE,
  canonical_title TEXT NOT NULL,
  original_title TEXT,
  year INTEGER,
  director TEXT,
  countries JSONB NOT NULL DEFAULT '[]'::JSONB,
  alternate_titles JSONB NOT NULL DEFAULT '[]'::JSONB,
  runtime NUMERIC,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  verification_level TEXT NOT NULL DEFAULT 'PROVISIONAL',
  coverage_tier INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_title (
  work_id TEXT NOT NULL REFERENCES work(work_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  title_type TEXT NOT NULL DEFAULT 'ALTERNATE',
  language TEXT,
  source_id TEXT,
  PRIMARY KEY (work_id, normalized_title, title_type)
);
CREATE INDEX IF NOT EXISTS work_title_normalized_idx ON work_title (normalized_title);

CREATE TABLE IF NOT EXISTS ingest_candidate (
  candidate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingest_run_id UUID NOT NULL REFERENCES ingest_run(run_id) ON DELETE CASCADE,
  registry_source_id TEXT REFERENCES source_registry(source_id),
  external_id TEXT,
  source_url TEXT NOT NULL,
  title TEXT,
  normalized_title TEXT,
  year INTEGER,
  director TEXT,
  runtime NUMERIC,
  poster_url TEXT,
  parser_id TEXT,
  candidate_status TEXT NOT NULL DEFAULT 'DISCOVERED',
  rejection_reason TEXT,
  candidate_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ingest_candidate_source_idx ON ingest_candidate (registry_source_id, external_id);

CREATE TABLE IF NOT EXISTS playback_source (
  source_id TEXT PRIMARY KEY,
  work_id TEXT REFERENCES work(work_id) ON DELETE SET NULL,
  registry_source_id TEXT NOT NULL REFERENCES source_registry(source_id),
  source_owner TEXT NOT NULL,
  canonical_source_url TEXT NOT NULL,
  full_film_verified BOOLEAN NOT NULL DEFAULT FALSE,
  free_verified BOOLEAN NOT NULL DEFAULT FALSE,
  official_or_rights_verified BOOLEAN NOT NULL DEFAULT FALSE,
  embed_status TEXT NOT NULL,
  embed_url_if_allowed TEXT,
  external_watch_url TEXT,
  territories JSONB NOT NULL DEFAULT '[]'::JSONB,
  audio_languages JSONB NOT NULL DEFAULT '[]'::JSONB,
  subtitle_languages JSONB NOT NULL DEFAULT '[]'::JSONB,
  version_or_restoration TEXT,
  runtime NUMERIC,
  first_verified_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  verification_evidence JSONB NOT NULL DEFAULT '[]'::JSONB,
  availability_expiry_if_known TIMESTAMPTZ,
  live_check_status TEXT NOT NULL DEFAULT 'PENDING',
  lifecycle_status TEXT NOT NULL DEFAULT 'STAGED',
  watch_state TEXT NOT NULL DEFAULT 'NO_VERIFIED_FREE_STREAM',
  adapter_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS playback_source_watch_idx ON playback_source (watch_state, lifecycle_status);
CREATE INDEX IF NOT EXISTS playback_source_registry_idx ON playback_source (registry_source_id);

CREATE TABLE IF NOT EXISTS source_verification (
  verification_id BIGSERIAL PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES playback_source(source_id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL,
  full_film_verified BOOLEAN NOT NULL,
  free_verified BOOLEAN NOT NULL,
  official_or_rights_verified BOOLEAN NOT NULL,
  live_check_status TEXT NOT NULL,
  embed_status TEXT NOT NULL,
  watch_state TEXT NOT NULL,
  http_status INTEGER,
  evidence JSONB NOT NULL DEFAULT '[]'::JSONB,
  error_code TEXT,
  verifier TEXT NOT NULL DEFAULT 'source-ingestion',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS source_verification_source_idx ON source_verification (source_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS media_asset (
  asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id TEXT REFERENCES work(work_id) ON DELETE SET NULL,
  asset_type TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  usage_basis TEXT NOT NULL DEFAULT 'UNKNOWN',
  license_verified BOOLEAN NOT NULL DEFAULT FALSE,
  attribution TEXT,
  source_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS source_health_check (
  health_check_id BIGSERIAL PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES playback_source(source_id) ON DELETE CASCADE,
  checked_at TIMESTAMPTZ NOT NULL,
  http_status INTEGER,
  live_check_status TEXT NOT NULL,
  response_url TEXT,
  error_code TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE TABLE IF NOT EXISTS work_merge_event (
  merge_id BIGSERIAL PRIMARY KEY,
  canonical_work_id TEXT NOT NULL REFERENCES work(work_id),
  merged_work_key TEXT NOT NULL,
  match_method TEXT NOT NULL,
  confidence NUMERIC NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE VIEW public_watchable_sources AS
SELECT *
FROM playback_source
WHERE full_film_verified = TRUE
  AND free_verified = TRUE
  AND official_or_rights_verified = TRUE
  AND live_check_status = 'PASS'
  AND lifecycle_status IN ('VERIFIED', 'PUBLISHED')
  AND watch_state IN ('WATCH_HERE', 'WATCH_FREE_EXTERNALLY');
