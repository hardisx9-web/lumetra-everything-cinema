-- Additive ingestion state; existing reports, identities and public proof policy are unchanged.
ALTER TABLE ingest_run ADD COLUMN IF NOT EXISTS registry_snapshot JSONB;
ALTER TABLE ingest_run ADD COLUMN IF NOT EXISTS store_version INTEGER;
ALTER TABLE ingest_run ADD COLUMN IF NOT EXISTS summary_json JSONB;

CREATE TABLE IF NOT EXISTS ingest_source_result (
  ingest_run_id UUID NOT NULL REFERENCES ingest_run(run_id) ON DELETE CASCADE,
  registry_source_id TEXT NOT NULL REFERENCES source_registry(source_id),
  enumeration_status TEXT NOT NULL,
  enumeration_complete BOOLEAN NOT NULL DEFAULT FALSE,
  blocker TEXT,
  requests JSONB NOT NULL DEFAULT '[]'::JSONB,
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  result_sha256 TEXT NOT NULL,
  result_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'ENUMERATED',
  summary_json JSONB,
  enumeration_persisted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  PRIMARY KEY (ingest_run_id, registry_source_id)
);

ALTER TABLE ingest_candidate ADD COLUMN IF NOT EXISTS work_id TEXT REFERENCES work(work_id);
ALTER TABLE ingest_candidate ADD COLUMN IF NOT EXISTS match_review TEXT;
ALTER TABLE ingest_candidate ADD COLUMN IF NOT EXISTS resolution_json JSONB;
ALTER TABLE ingest_candidate ADD COLUMN IF NOT EXISTS snapshot_sha256 TEXT;
CREATE INDEX IF NOT EXISTS ingest_candidate_identity_idx ON ingest_candidate (registry_source_id, source_url, work_id);
-- Do not impose a new uniqueness constraint on preexisting historical playback rows.
CREATE INDEX IF NOT EXISTS playback_source_identity_idx ON playback_source (registry_source_id, canonical_source_url);

-- Unknown/provider-local schemes are namespaced by registry ID; only explicitly
-- recognized global film schemes use a shared namespace.
CREATE TABLE IF NOT EXISTS work_identifier (
  namespace TEXT NOT NULL,
  external_id TEXT NOT NULL,
  work_id TEXT NOT NULL REFERENCES work(work_id),
  registry_source_id TEXT REFERENCES source_registry(source_id),
  identifier_scheme TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (namespace, external_id)
);
CREATE INDEX IF NOT EXISTS work_identifier_work_idx ON work_identifier (work_id);

CREATE TABLE IF NOT EXISTS work_resolution_event (
  event_key TEXT PRIMARY KEY,
  work_id TEXT REFERENCES work(work_id),
  ingest_run_id UUID REFERENCES ingest_run(run_id),
  candidate_id UUID REFERENCES ingest_candidate(candidate_id),
  registry_source_id TEXT REFERENCES source_registry(source_id),
  source_url TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('CREATED', 'REUSED', 'REVIEW')),
  match_method TEXT NOT NULL,
  confidence NUMERIC NOT NULL,
  evidence JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS work_resolution_event_work_idx ON work_resolution_event (work_id);

-- API inserts are append-only, keyed by (source, run) from migration 003.
-- The full redacted record snapshot permits strict, deterministic replay checks.
ALTER TABLE source_verification ADD COLUMN IF NOT EXISTS candidate_id UUID REFERENCES ingest_candidate(candidate_id);
ALTER TABLE source_verification ADD COLUMN IF NOT EXISTS record_sha256 TEXT;
ALTER TABLE source_verification ADD COLUMN IF NOT EXISTS record_json JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS source_verification_candidate_run_idx ON source_verification (ingest_run_id, candidate_id) WHERE candidate_id IS NOT NULL;

-- Protect only new ingestion-store observations. Legacy rows retain their existing
-- behavior; no completed report/verification is changed by this migration.
CREATE OR REPLACE FUNCTION protect_ingestion_verification() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.record_sha256 IS NOT NULL THEN
    RAISE EXCEPTION 'ingestion verification snapshots are immutable; append in a new run' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ingestion_verification_immutable ON source_verification;
CREATE TRIGGER ingestion_verification_immutable BEFORE UPDATE OR DELETE ON source_verification
  FOR EACH ROW EXECUTE FUNCTION protect_ingestion_verification();

CREATE OR REPLACE FUNCTION protect_ingestion_candidate() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.snapshot_sha256 IS NOT NULL AND
    ROW(OLD.ingest_run_id,OLD.registry_source_id,OLD.source_url,OLD.external_id,OLD.title,OLD.normalized_title,OLD.year,OLD.director,OLD.runtime,OLD.poster_url,OLD.parser_id,OLD.candidate_json,OLD.snapshot_sha256)
    IS DISTINCT FROM
    ROW(NEW.ingest_run_id,NEW.registry_source_id,NEW.source_url,NEW.external_id,NEW.title,NEW.normalized_title,NEW.year,NEW.director,NEW.runtime,NEW.poster_url,NEW.parser_id,NEW.candidate_json,NEW.snapshot_sha256) THEN
    RAISE EXCEPTION 'ingestion candidate snapshots are immutable; enumerate in a new run' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ingestion_candidate_immutable ON ingest_candidate;
CREATE TRIGGER ingestion_candidate_immutable BEFORE UPDATE ON ingest_candidate
  FOR EACH ROW EXECUTE FUNCTION protect_ingestion_candidate();
