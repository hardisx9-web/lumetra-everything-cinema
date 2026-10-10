# Lumetra hosted release

Deployable Sites/Cloudflare Worker + D1 edition of the preserved Lumetra Phase 1 rebuild. Original PostgreSQL and ingestion sources remain in the separate lumetra-rebuild project. This checkout publishes only the sanitized catalogue snapshot and authorized supplied media.

## Hosting

Use the Sites plugin workflow and the existing project_id in .openai/hosting.json. Preserve its access settings. Build with the plugin build-site.mjs helper. Hosted migrations are schema-only; initial publication data is loaded server-side in 87 resumable transactional batches. The first opening shows import progress while the original opening film plays. Further visits perform one readiness check. No arbitrary records or SQL are accepted from visitors.

Search, pagination, dossiers, related works and availability filtering run in D1. A browser never downloads the whole catalogue to search. Publication seeds are sanitized static export files read by the Worker. Re-export and version the snapshot to update data; no automatic PostgreSQL ingestion scheduler is deployed in this release. Existing source verification expires after its original 7-day window; expired links disappear from Watch. Never manufacture new verification dates.

## Verification

`node scripts/test-hosted.mjs` checks publication import, counts, indexed search, filters, dossiers, metadata and validation using a D1-compatible SQLite adapter. `bash scripts/run-smoke.sh` exercises the built Worker against isolated local D1 state after applying the migration to .wrangler/smoke-state. Keep preview and smoke-test database directories separate: independent Miniflare processes must not write one local database simultaneously.

## Scope

This is the first working product release, not completion of the full editorial mission. Artwork recovery is in progress: the current approved export covers nine Works (five posters, three stills, one production photograph), up from four. The other 20,503 Works still require artwork research or permission. See docs/artwork-coverage-after.json and docs/ARTWORK-SOURCES.md; original owner media is unchanged. Inherited editorial entries are marked for review. There are no verified embedded sources in this snapshot. Physical Android testing, full accessibility audit, automatic source-health scheduling and broad dossier enrichment remain outstanding.

## Local artwork development (not deployment)

`npm run preview:catalogue` serves the actual catalogue API and public UI at `http://127.0.0.1:4173` using persistent, project-local SQLite with the same query modules and additive migrations. This is a Termux-compatible preview, not Cloudflare workerd certification. `npm run test:artwork` runs matching, UI-helper, real catalogue-import and programming checks. `node scripts/smoke-artwork.mjs` tests the running preview and decodes every published artwork variant.

Artwork acquisition runs against the authorized archival PostgreSQL configuration. Commands, saved run IDs, permissions and continuation limits are in `docs/ARTWORK-OPERATIONS.md`. Do not rerun historical source ingestion or reset the catalogue. No production deployment was made for this artwork update.
