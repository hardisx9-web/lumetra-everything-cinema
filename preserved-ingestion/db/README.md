# PostgreSQL source of truth

Set `DATABASE_URL` (PostgreSQL connection URL) and, for local socket connections with no username in the URL, `PGUSER`. Do not commit credentials. On Termux the locally initialized cluster uses a Unix socket only; the operator starts it with `pg_ctl -D "$HOME/.local/share/global-cinema-pg" start` and can use `DATABASE_URL="postgresql:///global_cinema?host=$PREFIX/tmp" PGUSER="$(id -un)"`. Local trust authentication is restricted by Android's app sandbox and the server listens on no TCP interface; configure stronger authentication before exposing it to other users.

From project root:

1. `node scripts/db-migrate.mjs` — transactional, versioned migrations.
2. `node scripts/db-import-ingestion.mjs` — immutable, content-hash-idempotent historical report import; override `INGESTION_REPORT=/path/to/report.json` for additional reports. All 479 candidates and all 12 formerly asserted live records are retained, but *none* are presently public merely because a legacy report called them verified. `node scripts/db-import-legacy-catalogue.mjs` additionally preserves 21 existing editorial Works (and their four archive links, without claiming playback rights); both commands can be rerun safely.
3. `node scripts/db-health-check.mjs` — check eligible sources and record provider evidence and downgrades. `--dry-run` and `--limit=N` are available. Run daily from a scheduler, or supervise `node scripts/db-health-loop.mjs --interval-hours=24` (starts immediately and checks every day while running). Restart the loop after reboots; it is not installed as a service.
4. `node scripts/db-export-public.mjs --output=src/data/ingested-catalogue.js` (or `npm run publish:sources`) — derived frontend module; publication now always uses PostgreSQL, never the historical JSON report. This file is never authoritative. Without `--output`, emits JSON. Source selection always goes through the database eligibility view. Artwork without verified licensing is omitted.
5. `node --test db/persistence.test.mjs db/ingestion-store.test.mjs` — creates/drops isolated *real PostgreSQL databases*; needs `CREATEDB` rights. Do not point tests at an account without those rights.

The view requires an independent recent `provider-health-check` row and complete-film, free, official, live, nonexpired evidence; embedded viewing additionally requires explicit permission, a working embed and an embed URL. An HTTP 200 or a legacy ingestion assertion cannot qualify. Ingestion and recurring health checks share `lib/ingestion/verification.mjs`. NFB checks use the official film API classification/runtime, matching film detail and player, complete matching-duration HLS VOD playlist and accessible media-segment headers. HENRI/DFI use institution-linked Vimeo identity/duration and the same media proof. Inaccessible players, paid-only items, unclear territory/permissions, unsupported playback contracts and uncertain results stay nonwatchable. A 404/410 or expired availability fails closed. NFB third-party noncommercial embed conditions have NOT been approved for this project, so confirmed films are external-only. Posters without verified licensing remain omitted. The frontend rechecks the proof flags, independent verifier provenance, seven-day freshness, expiry and working-embed flag instead of trusting a watch label.

## Source-specific, resumable sweeps

- `npm run ingest:sources` now runs the PostgreSQL-backed source-specific pipeline, with no title-count cap. Discovery for every selected source is committed before slow playback checks. Migration 004 is additive; existing reports, Works, source identities and historical evidence are retained.
- `node scripts/enumerate-catalogues.mjs --output-dir=.research/sweeps/<new-name>` archives official discovery observations without claiming playback verification. Reusing an interrupted directory skips saved source observations instead of restarting them. These files are evidence/transport snapshots, not the long-term system of record.
- `node scripts/sweep-sources.mjs --enumeration-dir=.research/sweeps/<name>` persists those exact observations, then verifies all candidates. `--source=<registry-id>` / `--priority=P0` explicitly select scope. `--report-only` commits discovery and leaves a resumable run; it does not publish.
- `node scripts/sweep-sources.mjs --resume=<run-uuid>` resumes from PostgreSQL's next unchecked candidate, using immutable saved discovery. Do not launch a competing sweep; the runner holds an advisory lock. Save the run UUID printed by the runner. New observations belong in a new run, not a changed completed snapshot.
- `node scripts/db-catalogue-report.mjs --run=<run-uuid> --output=.research/source-sweep-report.json` emits source-by-source and global counts from a consistent PostgreSQL snapshot, including unresolved identities, pending checks, actual blockers and the last-checked time.
- `node scripts/sweep-report-follow.mjs --run=<run-uuid>` refreshes the report and eligible frontend cache every five minutes during a long sweep, refreshes once more when it finishes, then exits. It does not install a service. If the ingestion process disappears, it records the interrupted checkpoint without changing the run.
- `INGEST_CONCURRENCY` controls network-worker concurrency (default 4); it never caps catalogue size. Access denials and rate limits are respected; signed media parameters are never persisted or rewritten, TLS verification is never disabled, and no film is downloaded/rehosted.
- Entity resolution records Unicode aliases, country/runtime clues, scoped provider IDs and recognized shared film IDs. Ambiguous/conflicting identities stay in review. Incomplete metadata also stays in review unless an explicitly validated provider-native identity contract applies (currently BFI `bfi_nid`, scoped to `bfi_player_free`); that exception creates/reuses only source-scoped provisional identity, never title/year-only cross-source matches. `work_resolution_event` records reuse evidence; “duplicates merged” in reports means multiple candidate associations to one canonical Work, not deletion of historical rows.
- The daily health loop checks all eligible sources by default (an explicit `--limit=N` is diagnostic only), appends evidence/downgrades and refreshes the derived frontend cache. Schedule discovery/sweeps separately to discover new films and revisit previously uncertain sources; neither job is installed as a boot service.

## Continuation checkpoint — 2026-10-07

The update interrupted the prior session immediately after `lib/ingestion/catalogues.mjs` was written. No Git repository exists in this folder. No app build, dependency reinstall, PostgreSQL restart or data reset was performed during continuation. The pre-continuation code/data snapshot is `.research/resume-baseline/`; the original `src/data/source-ingestion-report.json` is preserved unchanged.

Live discovery snapshots: `.research/sweeps/resumed-source-sweep/`. PostgreSQL sweep UUID: **`0c76d488-58af-46f4-a290-59a0b36dc2cf`**. All **9,357** distinct source URLs are persisted. Playback verification is **still running**, not complete. The report follower refreshes `.research/source-sweep-report.json` and the frontend cache as current independent proofs arrive. Inspect the run before launching anything:

```sh
# With the local DATABASE_URL / PGUSER configured as above:
ps -A -o pid,ppid,args | grep -E 'sweep-sources|sweep-report-follow'
psql "$DATABASE_URL" -X -c "SELECT run_id,status,finished_at FROM ingest_run WHERE run_id='0c76d488-58af-46f4-a290-59a0b36dc2cf';"
# Only if the sweep process was interrupted and the run is still RUNNING:
node scripts/sweep-sources.mjs --resume=0c76d488-58af-46f4-a290-59a0b36dc2cf
```

Discovery reached the source-published end for NFB (6,280 distinct URLs from all 78 advertised API pages / 7,737 returned items), Mosfilm (1,612), DFI (438), HENRI (412), Retina Latina (418), and Filmoteca UNAM (97). This is catalogue enumeration, not a statement that these films all passed free/full/live checks. 35mm supplied 100 visible source assets before its search API returned HTTP 500; they are retained as partial discovery, not an exhaustive catalogue.

Unfinished/blocked access:
- LOC: `SOURCE_ACCESS_BLOCKED` on the approved public JSON API; obtain authorized access for this client/network via LC-Labs@loc.gov. No bypass attempted.
- KOFA, Saina, AP International: official YouTube Data API key needed (`YOUTUBE_API_KEY`, never commit it), then official-channel ownership and full-film/free/current playback audit. RSS is not exhaustive; video/API visibility alone is not a free-film proof.
- Films Division/NFDC: the two official endpoints failed TLS checks (`CERT_HAS_EXPIRED` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE`); operator must restore valid certificates and official VOD/feed access.
- 35mm: official search API HTTP 500; current visible records include explicit paid/subscription prices and must not inherit the registry's free default.
- Seven P1 targets remain `SOURCE_ADAPTER_UNAVAILABLE`, which is unfinished implementation, NOT proof that those providers are unavailable.
- Retina InstantVideoCloud and platform-hosted Mosfilm/UNAM films still need their supported independent playback contracts. Unknown audio/subtitle/territory/restoration metadata and unlicensed artwork remain explicit gaps.

Checks actually run: `npm test` (editorial/data smoke, 20 runtime route smokes and all exported database Work routes, source-model/adapters, 9 ingestion unit tests), `npm run check`, and `node --test db/persistence.test.mjs db/ingestion-store.test.mjs lib/ingestion/ingestion.test.mjs` with the local PostgreSQL environment (**27 passed, no skips**). A real `db-health-check.mjs --dry-run --limit=1` returned a nonwatchable HENRI pending/access-blocked result; that was a one-source diagnostic, not an exhaustive health sweep. No separate lint/typecheck command is configured. Build and browser/server startup were intentionally NOT run per the no-rebuild/no-restart instruction. Runtime smokes are DOM-harness checks, not a claim of a browser screenshot.

Historical next action (superseded by the embed-audit checkpoint below): the source sweep subsequently finished its persisted run as `PARTIAL` at 2026-10-07 11:50:25 UTC. Do NOT restart enumeration, ingestion, or that completed sweep. Its recorded provider/access gaps remain historical context, not a request to repeat it.

## WATCH_HERE embed-only audit — 2026-10-07

Goal: audit the existing **3,883 PASS + WATCH_FREE_EXTERNALLY source records / 2,975 canonical Works**, without touching the completed source sweep or replacing data. The baseline is **6,873 Works / 9,754 playback sources**. All eligible records belong to `nfb_canada`; other registry sources have no records in this cohort.

- Additive migration **005** creates `embed_audit_run`, immutable cohort snapshots (`embed_audit_item`), and one transactional decision/checkpoint per source (`embed_audit_result`). `playback_source.embed_checked_at` and `embed_verification_evidence` are separate from original health evidence and timestamps. No health/ingestion rows are updated, inserted or deleted by this audit.
- Run UUID: **`866ab8ac-4b56-46ae-9e01-3f31eed8d006`**. **COMPLETED**, from **2026-10-07 12:42:25 UTC** to **13:15:49 UTC**. All **3,883 sources / 2,975 Works** have persisted decisions; **zero pending**. Final report: `.research/embed-audit-report.json`; `.research/embed-audit-checkpoint.json` holds the run identity. Processing had no source-count cap, used four rate-spaced network workers, and made 7,739 HTML/terms requests (no film/media requests).
- `npm run db:audit-embeds` resumes/reports the latest audit by default; a completed run is not repeated. Explicit resume: `node scripts/audit-embeds.mjs --resume=866ab8ac-4b56-46ae-9e01-3f31eed8d006`. `npm run db:audit-embeds:report` only refreshes the report. `--new-run` intentionally starts a new cohort; do not use it to resume this run. Use the local database environment documented above. A database advisory lock prevents competing embed audits.
- The auditor fetches each existing canonical film page and only the exact player offered in its share template. It checks film/version identity, actual X-Frame-Options/CSP frame-ancestors, and provider branding/linkback. Provider attribution text and links are retained as evidence. Missing offers/configs, errors and uncertain restrictions stay in review; only observed explicit frame denial or 404/410 is counted as technically disabled/unavailable. No guessed player URLs, film/media requests, authentication, referer/origin impersonation, TLS bypass, rehosting, proxying or provider-control changes occur. Signed player media parameters are not persisted.
- **Permission blocker:** official [NFB terms](https://help.nfb.ca/terms/) (last updated May 11, 2026) grant personal/noncommercial embedding subject to general conditions; institutional, educational and other nonprivate uses require written authorization/licensing. Free access or nonprofit status alone is not approval. Global Cinema's qualifying personal/private use or applicable written NFB permission has not been provided. The audit does not resolve these overlapping conditions by assuming permission.
- **Technical release blocker:** an official iframe/config and permissive frame headers are not actual third-party browser playback proof. No deployed Global Cinema origin or browser playback verifier is configured. Therefore the current automatic adapter cannot promote a merely offered player. `WATCH_HERE` requires reviewed project permission, satisfied attribution/branding, current offered-film identity and real third-party playback evidence, with external fallback preserved.
- Current-check evidence is stored per source in PostgreSQL; `.research/embed-audit-report.json` is derived. Its outcome buckets do not overlap; reason/error counts can overlap those buckets. “Sources audited” means a persisted decision/attempt, not a declaration that every film was successfully played. The report compares counts and content digests for all Works, original source verifications, ingestion candidates/runs and protected playback fields against the start snapshot.

Changed files: `db/migrations/005_embed_audit.sql`, `db/embed-audit-store.mjs`, `db/embed-audit-store.test.mjs`, `lib/ingestion/embed-audit.mjs`, `lib/ingestion/embed-audit.test.mjs`, `scripts/audit-embeds.mjs`, `package.json`, this README, and the derived audit checkpoint/report. Existing source-sweep snapshots, source registry, original verification evidence and frontend cache are not replaced.

Checks run from project root: `node --test lib/ingestion/embed-audit.test.mjs` (**10 passed**); `npm run test:embeds:db` with local PostgreSQL (**6 passed**, new isolated schema only; production records untouched); `npm run check` (**passed**); `npm test` (**passed**, 19 ingestion/embed unit tests plus existing source and runtime checks); `npm run test:db` with local PostgreSQL (**18 passed**, newly created isolated test databases only). `node scripts/db-migrate.mjs` skipped migrations 001–004 and applied additive 005. Separate lint/typecheck commands are not configured. Build, frontend cache export and app/server/database restart were **not run**. No browser playback success is claimed.

### Final embed-audit results

| Metric | Count |
| --- | ---: |
| Source records audited (decisions/attempts) | 3,883 |
| Unique films audited | 2,975 |
| WATCH_HERE source records / unique films | 0 / 0 |
| WATCH_FREE_EXTERNALLY remaining sources / unique films | 3,883 / 2,975 |
| Confirmed prohibited embeds | 0 |
| Confirmed technically disabled/unavailable embeds | 0 |
| Uncertain/manual-review embeds | 3,883 |
| Source checks with errors (included in manual review) | 29 |
| Pending | 0 |

Registry breakdown: **`nfb_canada`** accounts for every count above; no other registry had eligible records in the requested cohort. **3,854** players had current matching full-film/version config, offered embed code, branding/linkback and no observed frame-header denial, but NOT approved project permission or verified browser playback. **29** checks had errors: **26** network failures, **2** response-read failures, **1** HTTP **502** from the offered player for `https://www.nfb.ca/film/bearing_witness_robert_coley_donohue/`. These are not evidence of a permanent provider prohibition or disabled embed. No access/429 blocker was encountered. Error rows and per-source evidence remain persisted for focused future review.

All **3,883** audit decisions were applied with matching per-source checked timestamps; no source has a fabricated/populated permitted embed URL or `embed_working=true`. Final public eligibility is still **3,883 sources / 2,975 Works**. Counts and content digests match the baseline for all **6,873 Works**, **9,754 playback sources**, **9,852 original source verifications**, **9,840 ingestion candidates**, ingestion runs and protected playback fields. The original free/full/official/live flags, verification evidence, health timestamps, external fallbacks and identities remain unchanged. A real `audit-embeds.mjs --resume=<this-UUID> --report-only` completed with `skipped_completed_run=true` and zero re-audits; the audit process has exited successfully.

Next step: resolve the NFB project-use/licensing question through [NFB contact](https://help.nfb.ca/contact-the-nfb/), then supply the intended Global Cinema origin and verify actual third-party playback with provider code, attribution/branding and territory restrictions intact. The 29 failed network checks need focused rechecking before any technical approval. Do not interpret the completed decision pass as completed legal/player certification, and do not rerun the completed source sweep.

## Seven missing enumeration adapters — 2026-10-07

Implemented and audited only `bfi_player_free`, `eye_film_player`, `cinemateket_play_sweden`, `nfaj_japanese_animation_classics`, `nz_on_screen`, `angel_digital`, and `shemaroo`. The registry, historical source reports, completed sweep and NFB embed audit were not replaced or rerun. No migration, import/reset, database restart, build, or frontend-cache export was performed. No Git repository exists here.

Discovery snapshots and page-level progress: `.research/sweeps/seven-missing-adapters-20261007/`. PostgreSQL run: **`a420ea9b-1900-4c95-8c5d-69df8ffa75f7`**, started **14:02:54 UTC**, finished **17:00:29 UTC**, terminal status **PARTIAL**. All **13,957** candidates have persisted verification attempts; **zero unchecked candidates**. Four catalogues reached their published end; Cinemateket is partially visible on this territory and both rights-holder providers need an API key. The pipeline is finished, but free/live verification is deliberately NOT complete: no new title passed every full/free/official/live gate.

| Provider | Candidates | Canonical Works | Verified free unique films | Disqualified | Unavailable | Pending review |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| bfi_player_free | 12,058 | 1,897 | 0 | 255 | 608 | 11,195 |
| eye_film_player | 483 | 473 | 0 | 263 | 0 | 220 |
| cinemateket_play_sweden | 11 | 0 | 0 | 0 | 0 | 11 |
| nfaj_japanese_animation_classics | 64 | 58 | 0 | 27 | 0 | 37 |
| nz_on_screen | 1,341 | 1,049 | 0 | 346 | 20 | 975 |
| angel_digital | 0 | 0 | 0 | 0 | 0 | 0 |
| shemaroo | 0 | 0 | 0 | 0 | 0 | 0 |

Counts are PostgreSQL observations, not provider-wide film totals. Canonical Works require the existing entity-resolution clues; **10,480** candidates still have unresolved identity. Disqualified and unavailable buckets are separate, nonwatchable terminal outcomes; pending means an attempt was saved but identity/free/full/live evidence is unresolved, not that the runner still needs to check it. A finished source means every candidate was attempted, not that every candidate became watchable.

### Exact remaining boundaries

- **BFI**: every child of its published sitemap was traversed (five documents including the index); `/search/` is robots-disallowed and was never crawled. 6,606 title requests redirected outside the audited `/free/film/` contract; 4,567 did not provide an observable matching full-player plus explicit free CTA. Current SSR can contain an empty free-button label, which is not treated as title-specific free proof. 255 supplementary/clip records were disqualified; 608 were unavailable. Other access/read errors stay pending. No Brightcove policy/JWT keys, protected endpoint or guessed media were used; an audited anonymous full-player live contract is still required before promotion.
- **Eye**: five anonymous AudiencePlayer ArticleList pages cover all 483 published film articles, including paid titles. Fresh article IDs/slugs were independently matched. 263 paid/rental records were rejected; 210 have unconfirmed current free status and 10 explicitly free records require an authorized account. No login/play mutation or account token was used.
- **Cinemateket Play**: institutional link to the current service confirmed; no retired Filmarkivet records imported. Its current service reports `isOpenServiceActive=false` for provider-observed country `AE`. Only 11 public cards were discoverable; no geography override, MAGINE session reuse or authenticated catalogue request was attempted. Provider-authorized territory access or a public metadata feed is needed.
- **NFAJ**: all 64 works from both published listing pages retained; 27 incomplete films rejected using title-specific completeness. The remaining 37 delegate playback to the institution-linked NII host `h10.cs.nii.ac.jp`; that player/robots/playback contract has not been audited. No NII/media request was made. Archive embedding remains prohibited.
- **NZ On Screen**: both public Film (614) and Short film (727) categories were fully traversed across 68 pages. Actual final-page `page_size` is the remaining count, not capacity; the adapter stops at unique advertised totals. Rentals, trailers/excerpts and TV records were rejected. 477 actual full/free-film listings still need a supported Brightcove live contract; missing title players, uncertain classification and transient network/API errors remain pending. No Brightcove/media key or off-domain media request was used.
- **Angel / Shemaroo**: the rights-holder websites identify respectively 1 and 19 official channel URLs. Exhaustive uploads enumeration requires **`YOUTUBE_API_KEY`**, currently absent. The implemented API path follows every uploads `nextPageToken`, verifies channel/uploader identity, and never treats public API visibility as free full-film playback. RSS, licensing inventories, Klikk subscriptions and ShemarooMe paid offerings are not substitutes.

### Preservation, correction and checks

Read-only baseline/final audit: `.research/seven-provider-adapters/baseline-audit.json` and `final-audit.json`. Content digests and counts match for all original **6,873 Works**, **9,754 completed-provider playback sources**, **9,852 original source-verification rows**, **9,840 historical candidates**, original runs/source snapshots and all **3,883 NFB embed-audit items/results**. Protected source/audit files also match. New global totals: **10,351 Works**, **23,711 playback sources**, **2,975 verified-free unique films**, **0 WATCH_HERE**, **3,883 WATCH_FREE_EXTERNALLY sources / 2,975 unique films**. No title was promoted from catalogue visibility, HTTP success or iframe presence alone.

The first invocation stopped during NZ verification with `INGESTION_CONFLICT`: enrichment shared the immutable candidate's external-identifier object by reference. A failing parent-integration regression demonstrated the mutation; `verification.mjs` now clones that object. After tests passed, the same run resumed only the **1,185 unchecked NZ candidates**, preserving its previously saved 156 NZ attempts and skipping BFI/Eye/Cinemateket/NFAJ. No observation was overwritten or reimported. The final completed-run `--resume=... --report-only` returned `skipped:true` with no discovery/evidence restarted.

Changed implementation paths: `lib/ingestion/providers/bfi-eye-sfi-channels.mjs`, `lib/ingestion/providers/nfaj-nz.mjs` and their tests; `lib/ingestion/provider-policy.mjs` (robots, delays and redirect controls); `lib/ingestion/enumeration-checkpoint.mjs`; adapter registration/metadata isolation in `catalogues.mjs`/`verification.mjs`; redirect support and queued-denial recheck in `http.mjs`; checkpoint integration in `scripts/enumerate-catalogues.mjs` and `scripts/sweep-sources.mjs`; richer counts in `scripts/db-catalogue-report.mjs`; read-only `scripts/seven-provider-audit.mjs`; `package.json` test discovery; this handoff. No dependencies added. Audit notes: `.research/seven-provider-adapters/implementation-audit.md` and `.research/seven-provider-nfaj-nz-notes.md`.

Checks run from project root after the correction:

- `npm test` — passed existing editorial/runtime/source checks and **62 ingestion/embed/provider unit tests**, no skips.
- `npm run check` — passed structural checks.
- `npm run test:db` with the local PostgreSQL environment — **18 passed**, no skips, in isolated newly created test databases, not production reimports.
- Seven explicit `--source=` selectors in `enumerate-catalogues.mjs` and `sweep-sources.mjs`; then `sweep-sources.mjs --resume=a420ea9b-1900-4c95-8c5d-69df8ffa75f7` — discovery/verification persisted successfully; final run PARTIAL for the documented access/credential gaps.
- `db-catalogue-report.mjs --run=a420ea9b-1900-4c95-8c5d-69df8ffa75f7 --output=.research/seven-provider-adapters/run-report.json` and `seven-provider-audit.mjs --compare=.research/seven-provider-adapters/baseline-audit.json --output=.research/seven-provider-adapters/final-audit.json` — passed, protected database/file content unchanged.
- Separate lint/typecheck commands are not configured. Build, UI publication, browser playback and real free-film playback success were **not** claimed or run. All ingestion/enumeration processes exited. The existing pg8 driver emitted a nonfatal concurrent-query deprecation warning during final summary counts; pg9 compatibility is separate future maintenance.

Next authorized action: configure an enabled/quota-available `YOUTUBE_API_KEY` securely to unblock **only Angel/Shemaroo** discovery, or obtain a provider-approved playback/territory contract for a specific pending source. Do not rerun this finished run, the earlier completed source sweep, or the NFB embed audit. Playback-contract gaps in these adapters must not be described as proof that the providers offer no free films.

## BFI native identity repair and proposed reprocessing — 2026-10-07

Implementation is complete; **production reprocessing has NOT been executed**. No production migrations, imports, work-ID assignments, run reopening/deletion, frontend export, server/database restart or whole sweep were performed.

- BFI discovery now uses `https://search-es.player.bfi.org.uk/prod-films/_search`, with exact `pillar.raw=free`, an exact total and `search_after` sorted by keyword `nid`. It traverses beyond the 10,000-result window, validates every page and checkpoints its own versioned contract. Old sitemap checkpoints/snapshots are not converted in place.
- New candidates use `external_id=nid` and `external_identifiers.bfi_nid`, stored as `registry:bfi_player_free:bfi_nid` by the resolver. UUID is evidence/metadata, not a shared cross-provider identity. Structured title/original title, release year, supplied directors, country, duration, genres, archive, subjects, synopsis, availability and raw authoritative fields are retained. Native verification refreshes the exact nid and checks its canonical URL; missing HTML fields cannot erase authoritative search metadata or fabricate a director.
- Valid title + BFI native nid can create a PROVISIONAL Work without director/year. Re-observation and concurrent observations reuse the bound native identity. Different sparse nids never join by title/year. URLs, arbitrary schemes, caller trust/scope claims, foreign-source `bfi_nid`, and shared-only IDs do not grant sparse creation. Known metadata/identity conflicts remain REVIEW. Full title/year/director matching, country/runtime corroboration, recognized IMDb/TMDb/Wikidata/ISAN behavior and all watchability gates remain intact.
- `persistVerification()`'s metadata overlay and historical immutability protections were not changed. Regression tests exercise new-run enrichment without changing old candidate/verification snapshots.

### Separate detail-contract investigation

The **6,606** `BFI_DETAIL_OUTSIDE_FREE_CONTRACT` attempts were initial HTTP 301 redirects. Historical request logs include 6,606 successful BFI Replay `/video/` responses, but omit Location headers, so they do not prove every exact historical URL pairing. A bounded robots-aware diagnostic reproduced:

`https://player.bfi.org.uk/free/film/watch-10-minutes-in-brighton-1979-online` → HTTP 301 → `https://replay.bfi.org.uk/video/3d533774-6863-50d5-8186-2d485c009c69` → HTTP 200.

Replay remains **outside** the audited free-film/playback contract; the URL/security guard was not widened. New attempts record the final redirect URL/status before rejecting it, while authoritative native metadata remains available for identity resolution. Replay full-film/free/territory/live-playback evidence and the independent Brightcove live contract remain separate work. A native identity does not make a film watchable.

### Exact proposed scope (read-only plan, no ingestion started)

`node scripts/bfi-reprocessing-plan.mjs --run=<finished-run-uuid> --output-dir=<new-directory>` uses an explicitly read-only PostgreSQL transaction, obtains fresh BFI metadata through the existing robots/access-aware HTTP transport, and prepares a **new focused transport snapshot**. It cannot execute reprocessing and refuses to overwrite an existing directory. Only historical `missing title/year/director` reviews whose current playback identity is still unresolved are selected; exact-URL matching is mandatory and unmatched URLs are reported, never guessed.

Prepared transport: `.research/bfi-native-identity-reprocessing-plan-20261007/bfi_player_free.json`.
Exact target/provenance manifest: `.research/bfi-native-identity-reprocessing-plan-20261007/reprocessing-plan.json`.

For historical run **`a420ea9b-1900-4c95-8c5d-69df8ffa75f7`**:

- Fresh free catalogue: **12,058** records; **25** search pages. All selected historical URLs map to an authoritative native nid; **zero unmatched**.
- Proposed reprocessing: **10,161 candidates / 10,161 existing playback sources**, all currently unresolved identity reviews. Excludes the **1,897 already-resolved BFI candidates** and every other provider.
- Prior error breakdown: **6,606** outside-contract redirects; **2,679** missing free/full player offers; **629** source-unavailable errors (608 HTTP 404 plus 21 network/status-unknown); **224** supplementary-film rejections; **22** incomplete-film rejections; **1** terminated response.
- Fresh metadata in the cohort: **1,690** year+director; **8,427** year without director; **37** neither; **7** director without year. All have validated native nids. Resolution may still REVIEW actual conflicts/ambiguity; no recovery or playback success is preclaimed.
- Ordered target digest: `c1456fe170524b01d05b22c8939f2a7729bbdb6cd57fe23ad69ab12a43e8ba2c`.

Supported command, **proposed only, not run**:

```sh
node scripts/sweep-sources.mjs --source=bfi_player_free \
  --enumeration-dir=.research/bfi-native-identity-reprocessing-plan-20261007
```

This uses existing ingestion-store APIs to create a **new BFI-only run**, persist only the selected fresh candidate snapshots, resolve them normally, and append new verification observations. Current playback rows reuse the original canonical source URL/source identity and can be updated only by the store's newer-observation rules. Historical candidate/verification/run snapshots and their resolved associations stay unchanged. The focused transport explicitly has `enumeration_complete=false`; it does not claim exhaustive provider discovery. Do not use `--resume` on the old terminal run: it has zero unchecked candidates and correctly skips all saved observations.

Actual checks: `npm test` passed editorial/runtime/source checks and **67 ingestion/provider/embed/plan unit tests**; `npm run check` passed; local `npm run test:db` passed **24 real PostgreSQL integration tests**, no skips, in created/dropped isolated test databases. Syntax checks passed for the changed implementation scripts. There are no separate lint/typecheck commands. The read-only plan successfully traversed the real 12,058-record free catalogue; no playback media was requested. Final read-only production inspection still showed the old run PARTIAL with **12,058 BFI candidates, 1,897 resolved, 10,161 unresolved, 12,058 observations and zero public-watchable BFI sources**.

Next step: review/authorize the exact focused scope above before executing the proposed new run. The separate Replay/Brightcove playback contracts must not be weakened to turn identity recovery into a watchability claim.


