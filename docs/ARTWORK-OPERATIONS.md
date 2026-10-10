# Artwork recovery checkpoint — 9 October 2026

## Status and preservation

**Existing institutional recovery continuation (latest):** `docs/INSTITUTIONAL-ARTWORK-RECOVERY.md` and `docs/institutional-artwork-audit.json` now classify all 14,470 original media rows and complete run `e8533312-d09c-4c21-82db-45daf736495e`. All 14,470 are persisted as `RIGHTS_BLOCKED_EXISTING_REFERENCE`; zero were silently published. This is the prerequisite recovery result for NFB/BFI/Mosfilm/HENRI/Retina/35mm until item-level permissions arrive.


Repository: `~/projects/lumetra-omnirush/live-source`; branch `feature/cinematic-reconstruction`; base HEAD `5cff5de`; changes remain **uncommitted and undeployed**. Existing theater/intro/Horizon reconstruction changes were present before artwork work and remain in place. No database reset, source-ingestion restart, branch switch or production deployment occurred.

The native PostgreSQL source of truth is `global_cinema`, reached through the documented local Unix-socket configuration. The cluster was stopped after the session interruption and was started normally; no restore was performed. Whole-row checksums for Work, playback_source, ingest_candidate, source_verification and ingest_run match the saved baseline. Every original column of all 14,470 original media_asset records also matches. The initial inventory's accidental use of historical `asset_type` was repaired in additive migration 008; only separate derived artwork fields now carry new classifications. Evidence: `artwork-preservation-{baseline,final}.json`.

## Measured results

| Metric | Confirmed result |
|---|---:|
| Catalogue Works audited | 20,512 |
| Historical playback records | 23,711 |
| Eligible external source records / distinct Works | 3,883 / 2,975 |
| Embedded sources | 0 |
| Usable artwork before / after | **4 / 9 Works** |
| After: posters / stills / production photographs | 5 / 3 / 1 |
| Added on previously unpictured Works | **2 posters, 2 stills, 1 production photograph** |
| Films still without approved imagery | **20,503** |
| External decisions / distinct films attempted (including prior failed attempt) | 294 / 173 |
| Rejected search-candidate decisions / distinct Work–candidate pairs | 1,124 / 1,086 |
| Same-file duplicate records detected | 4, retained with duplicate provenance |
| Broken image URLs repaired | 0 confirmed |
| Inherited URL health sample | 250: 246 accessible image responses, 4 access blocks; not full decode or rights approval |
| Remaining inherited URL health checks | 14,220 |

The five newly pictured Works are **Atlantis (1913)** (Danish Film Institute poster via Commons, Åge Lund, CC BY 4.0), **The Hour of the Furnaces (1968)** (poster), **Meshes of the Afternoon (1943)** (still), **Pather Panchali (1955)** (publicity still) and **Daughters of the Dust (1991)** (1989 production photograph, CC BY-SA 4.0). Attribution, source and license URLs are in the database, API, public export and dossiers.

A proposed *Spring in a Small Town* image was acquired but **withheld** after visual inspection: Korean lettering/composite cover layout raises later-edition/cover-rights questions inconsistent with the simple Commons 1948-poster description. Its database evidence is preserved with `PENDING_EDITION_REVIEW`, `license_verified=false`, and its files are quarantined outside public assets. It is not counted in the nine. Two unregistered files from the earlier failed implementation were likewise moved out of public assets, not published. This demonstrates why a permissive search/license-label scraper would be unsafe.

**This is measurable progress, not completion of catalogue-wide artwork recovery.** The 14,470 original institutional references remain unlicensed for publication. Missing data and permission are not described as proof that no imagery exists.

## Implemented flow

- PostgreSQL additive migrations 006–009: artwork rights/match/review/health/dimensions/provenance/primary fields, frozen run queues, candidate evidence, provider cooldowns, duplicate links.
- `preserved-ingestion/lib/artwork/{policy,providers}.mjs`: conservative matching, rights allowlist, cached/rate-spaced Commons requests, LOC/Europeana discovery adapters (review-only), stop on access/throttle responses. No TMDB use.
- `artwork-enrich.mjs`: frozen input snapshots, per-Work decisions, resumable controlled batches, advisory lock, local image full decoding, checksums, proportional 320/640/960-or-smaller WebP variants. Existing approved images are reused before new requests.
- `artwork-reviewed.json`: exact Work/title/year/director/file mappings, evidence notes, and explicit withheld files. Reviewed identity does not override the independent rights gate.
- `export-artwork-public.mjs`: only approved, licensed, healthy, high-confidence assets; field-limited export; versioned D1 import; withdrawn IDs marked WITHHELD without deletion; factual language/genre/display-title metadata. No raw ingestion metadata or credentials exported.
- `drizzle/0002_artwork_enrichment.sql` and matching schema/snapshot: additive serving storage. Original Work/source tables and historical publication chunks remain unchanged.
- `site-server/catalogue.js`: artwork joined to search/dossier/related responses, display-title search, real-database programme, country-label normalization, session/day seed support, unique IDs across sections and current viewing gate. The sample pool rotates across the catalogue instead of the old first-500/hardcoded-four selection.
- `public/{app,artwork-ui,cinema-home}.js` and styles: 2:3 contained posters, labeled stills/production photos, factual title-treatment and image-error fallbacks, provenance, shared cards, actual-film history panels, reshuffle/error handling. No unrelated stock image substituted for film artwork. Intro and Horizon structures were not changed by this continuation.

## Saved enrichment runs

The catalogue queue to resume is:

`268c82a1-07f8-4297-80d6-9bfa92f74064` — **PAUSED**, 100 decisions (61 rejected / 39 no match), **20,407 pending** in its frozen cohort. Some Works were subsequently enriched in focused runs; the runner now reuses approved artwork before any new request for them.

Completed focused runs:
- `3235876f-3a61-43bb-ab39-6e3b582036ac`: reviewed first five assets.
- `beb3005b-f4d0-4bf4-b722-a044eefeea6f`: reviewed nine decisions; one later withheld as noted above. Completed-run resume was tested and did not repeat requests.
- `4eafbd87-6a71-4ae0-a705-48a2eee2397a`: 68 historical Works; 55 rejected, 12 no match, one network failure. Original broad title query was too noisy.
- `cfec22e9-7be4-48e3-851b-c9ebd7962fa4`: 68 historical Works using title + year + bitmap search; one authentic DFI poster accepted, 41 rejected, 26 no match.

The earlier interrupted implementation's 40-film run (32 failures including 30 HTTP 429s and two SQL bind errors) is retained as historical evidence. The current runner has serial 6.5-second spacing, caching, `maxlag`, cooldowns and pauses on throttles; it does not cascade through the catalogue on 429. No acquisition process is left running and no scheduler was installed.

## Resume commands (from repository root)

Use the already authorized local configuration; do not add credentials to files:

```sh
export DATABASE_URL="postgresql:///global_cinema?host=$PREFIX/tmp"
export PGUSER="$(id -un)"

# Normally already running; inspect before starting the existing cluster.
pg_ctl -D "$HOME/.local/share/global-cinema-pg" status

# Apply only unapplied additive migrations; never reset or reimport the catalogue.
node preserved-ingestion/scripts/db-migrate.mjs

# Continue the frozen queue, not a new 20k enumeration.
node preserved-ingestion/scripts/artwork-enrich.mjs \
  --mode=commons --run=268c82a1-07f8-4297-80d6-9bfa92f74064 --limit=25

# Publish approved data only to the LOCAL checked-in serving snapshot.
node preserved-ingestion/scripts/export-artwork-public.mjs
node preserved-ingestion/scripts/artwork-coverage-report.mjs \
  --output=docs/artwork-coverage-after.json
node preserved-ingestion/scripts/artwork-preservation-check.mjs
npm run test:artwork
```

`--new-run` creates a new observation cohort and is not a resume command. `--focus=history` targets the documented historical filmmaker scope. Do not repeat a completed run just to inflate counts. Failed/transient decisions remain explicit; a targeted review/new observation is required rather than rewriting completed evidence.

Image decoding uses project-local Sharp/WASM tooling because native Sharp is unavailable on Android. It already exists under `.sites-runtime/image-tools/`. If this ignored tooling is absent in another checkout, the exact local-only setup is:

```sh
npm install --prefix .sites-runtime/image-tools --no-audit --no-fund \
  --ignore-scripts sharp@0.35.4 @img/sharp-wasm32@0.35.4
```

Alternatively set `ARTWORK_SHARP_MODULE` to an authorized compatible existing Sharp module. No global configuration change is needed. API workers/browser code do not depend on this acquisition-only tool.

## Verification actually run

- `npm run test:artwork`: **24 unit/helper tests + 11 real SQLite/catalogue integration checks passed**, plus existing hosted import/search/dossier checks. Includes populated additive migration preservation, interrupted/versioned import, session/day rotation, uniqueness, license gate, ambiguous/remake rejection, missing-image metadata treatment and English display-title search.
- `node scripts/smoke-artwork.mjs`: actual local HTTP API, all nine dossiers and **22 image variants** fetched and fully decoded; image proportions, source/license data, filtering, original MP4 ranges, private publication 404, missing image 404, API validation and supplied owner-media SHA-256 checks passed.
- Fixed seed `owner-preview-2026-10-09`: **24 unique film IDs**, no duplicates across five homepage sections; **18 normalized country labels, 13 decades, 25 recorded language labels, 22 recorded genre labels**. Four selected Works lack country metadata. Eight selected Works have artwork; the other 16 use explicitly labeled title treatments. Language/genre values are source labels, not a newly reconciled global taxonomy.
- `artwork-preservation-check.mjs`: passed protected-table counts/digests and original asset-column digests.
- `node node_modules/typescript/bin/tsc --noEmit`: passed after adding the existing ASSETS binding type and literal `html_handling` type. No runtime/provider switch was made.
- Targeted ESLint for changed artwork/API/frontend/test scripts: passed, zero errors/warnings in the final targeted command. An earlier including inherited handler code produced four unused-destructuring warnings.
- `git diff --check`: passed.
- **Full `npm run lint` did not complete:** Node heap exhausted around 1 GB while traversing the repository. This is not recorded as a lint pass.
- **`npm run build` failed before application compilation:** Cloudflare workerd reports `Unsupported platform: android arm64 LE`. Full Worker build/smoke must run on a supported platform; the Node adapter preview is not presented as workerd certification.
- **Browser visual/mobile/WebGL testing not run:** no browser automation/runtime was available. `artwork-contact-sheet.jpg` is an inspected asset contact sheet, not a browser screenshot. The uncertain cover was caught here. Owner visual approval is still required.

## Preview and next owner action

Local preview is running at **http://127.0.0.1:4173/** using `scripts/preview-catalogue.mjs`, persistent database `.sites-runtime/artwork-preview.sqlite`. It uses the real application API modules and new export, not demo films. Inspect processes with `ps -A -o pid,args | grep '[p]review-catalogue'`. Stop that process when finished. To restart: `npm run preview:catalogue`. Restart after changing the generated artwork version; do not run two preview processes against the same local database.

Inspect:
- `/discover?artwork=1` — all nine approved Works.
- `/discover?q=Pather` and `/film/work-pather-panchali` — title search, still and provenance.
- `/film/work_ingested_7b8781195d2c27832a8d6e6e` — authentic *Atlantis* poster and DFI/CC BY attribution.
- `/film/work-spring-in-a-small-town` — safe title treatment; withheld cover must not appear.
- `/` — spatial scene, new programme, reshuffle, distinct section films, mobile Horizon and theater replay.

**Stop for visual approval; do not deploy.** Next high-yield data work is an authorized institutional artwork feed/license (especially NFB/BFI) and conservative DFI/Commons collection/native-ID matching, not more generic title-only searches. LOC's real probe returned 403; Europeana lacks a key; TMDB remains disabled pending an applicable permission/commercial arrangement. See `ARTWORK-SOURCES.md` and `artwork-provider-probes.json`.
