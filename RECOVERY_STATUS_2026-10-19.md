# Lumetra recovery checkpoint — 19 October 2026

**Status: recovery and image-system work completed in part; NOT release-ready. No deployment performed.**

This checkpoint continues the supplied project. It does not fulfil the complete-image acceptance requirement and must not replace the live website.

## Verified recovery

- Downloaded all 81 items present in `/Lumetra/WORK_HANDOFF_COMPLETE_2026-10-18/`.
- All nine checks in `Lumetra_Recovery_SHA256.txt` passed, including all five ZIP volumes.
- Reassembled the documented TAR.GZ stream and read all 94,238 archive entries.
- Extracted regular files safely. Recorded 42 links without following them, including absolute dependency-cache links into the previous phone environment. Original archive remains intact.
- Original Git HEAD matches `ca673de9dea0a40b0979737ee506d84f93dc7a42`. Recovered tracked edits and two untracked scripts remain untouched. `.npmrc` is absent from the supplied archive; its deletion appears in recovered Git status and is not an edit made here.
- Compared V3/V4/V5 archive contents after normalizing archive-root prefixes. 687 of V5's 1,119 paths differ from or are absent in V4. This includes added illustration files; it is not a count of code regressions.
- Used the latest supplied V5 code as an isolated development candidate, preserving its imported baseline in local Git. The recovered historical tree is separate and unchanged.

## Database evidence

PostgreSQL 16 rejected dump format 1.16. The archive header identifies PostgreSQL 18.6. A matching 18.6 `pg_restore` was built locally; full SQL extraction completed without error.

| Table | Extracted rows |
|---|---:|
| work | 20,512 |
| playback_source | 23,711 |
| source_verification | 33,970 |
| media_asset | 14,470 |
| ingest_candidate | 33,958 |

These are COPY-section counts from a complete SQL extraction, not proof of a running PostgreSQL server restore. A running-server restore and relational checks remain outstanding.

All 14,470 media assets are `POSTER` candidates with `license_verified=false` and `SOURCE_IMAGE_LICENSE_UNVERIFIED`, spanning 13,961 works. Providers: BFI 10,158; NFB 1,956; Mosfilm 1,428; Retina Latina 418; Cinémathèque Henri 410; 35mm Online 100. Candidate URLs are retained in `release-audit/inherited-media-candidates.json` and correlated to film identities in the coverage register. None is newly approved merely because its URL exists.

The actual catalogue integration test imported 20,512 works and 23,711 source records and reported **zero currently eligible sources and zero watchable works**, at its recorded test time. The supplied snapshot was exported on 8 October 2026. External verification must be refreshed before making current viewing claims. No remote data was changed.

## Implemented changes

- Quarantined the V5 generated visual library outside `public/`. Archived originals remain preserved.
- Removed numbered illustration selection from the learning, essay, navigation, museum, person and film-fallback code paths.
- Added `public/subject-images.js`: exact subject keys, rights/source links, attribution, match evidence, dimensions and explicit approval/health checks.
- Added real, locally stored photographs for prime lenses, macro lenses and 16 mm film. Captions identify photographic examples precisely; they do not claim these are cinema-lens models or identify film-base chemistry.
- Missing subjects display an explicit pending-review state in this unpublished candidate. These are **unfinished entries and release blockers**, not acceptable final substitutes.
- Added per-entry JSON/CSV coverage reports, inherited-media candidate inventory and a failing release gate.
- Corrected executable bits lost in source ZIP extraction. Dependency setup passed using the existing project workflow.
- Added a local build-only `.openai/hosting.json` containing DB binding configuration, without inventing a Site/project ID or changing a hosting account.

## Verified photographs

| Subject | Exact example | Photographer | Rights/source |
|---|---|---|---|
| Prime lens | Auto Revuenon 50 mm f/1.8 photographic prime | Flanoz | [CC0 file page](https://commons.wikimedia.org/wiki/File:Revuenon_Auto_50mm_prime_lens.jpg) |
| Macro lens | Vivitar Series 1 90 mm f/2.5 with macro adapter | Helmut Schütz | [CC BY-SA 2.5 file page](https://commons.wikimedia.org/wiki/File:Macro_Lens_Vivitar_90mm.jpg) |
| 16 mm film | Black-and-white sound-film strip | Runner1616 | [CC BY-SA 3.0 file page](https://commons.wikimedia.org/wiki/File:16mm_Movie_Film.jpg) |

Each was downloaded successfully, decoded and visually inspected. Original files are unchanged; hashes are in the generated image register. Browser loading has not yet been verified. These three records do not establish general image completion.

## Coverage and tests

The register currently enumerates **27,420 subject/visual requirements**, including 20,512 films, 6,253 distinct director-credit strings, 250 technologies, 309 crew entries, 19 camera milestones, 28 essays and group/navigation/museum visuals. It has **3 newly approved local photographs and 27,417 pending requirements**. The 41 additional profile aliases are counted separately. A director-credit string may name a group, multiple people or an unresolved identity; it is not treated as an authority-controlled person ID.

- Production framework build: passed.
- Artwork identity/rights and presentation tests: 28 passed, 0 failed.
- Learning HTML generation: 598 routes passed without rejected SVG illustration selection.
- Route contract: passed.
- Responsive CSS contract: passed; this is not rendered-device testing.
- Catalogue/API integration: passed, including multifilter search and dossier lookup.
- Programming/migration checks: 11 passed, 0 failed.
- Release gate: fails intentionally on unresolved images and outstanding verification.

No Android/desktop browser screenshots, rendered accessibility audit, image network crawl or runtime performance measurements were obtained. The environment has no supported browser-control skill, so these checks remain unperformed. No preview server was started and no public preview was deployed.

A read-only HTTP check of `https://lumetra-cinema-staging.hardisx9.workers.dev/` returned 200 with the Lumetra title. This establishes reachability only, not full live-site correctness. No live write, deployment, repository overwrite or external rights request was made.

## Release and rollback

Do not deploy this checkpoint. Complete image matching and rights research, verify all published routes and images in real browsers, restore/test PostgreSQL, refresh viewing-source verification, review article depth and run production configuration checks. Keep the original intro/logo and historical source snapshots.

When all gates pass, prepare the exact source commit, target Cloudflare configuration, asset/database backup and an immutable previous-release artifact for the owner's review. Obtain explicit deployment approval before any live deployment. Deploy only the reviewed commit; verify health and have the prior artifact/database snapshot available for rollback. No rollback action is currently needed because production was not changed.

## Reproduce local checks

From the candidate root with Node 24:

```sh
npm run install:ci
npm run build
node --test scripts/test-authentic-images.mjs scripts/test-artwork-ui.mjs preserved-ingestion/lib/artwork/policy.test.mjs
node scripts/test-route-contract.mjs
node scripts/test-responsive.mjs
node scripts/test-learning-render.mjs
node scripts/test-hosted.mjs
node scripts/test-programming.mjs
node scripts/audit-authentic-images.mjs --release
```

The final command must remain nonzero while release blockers exist. The source package excludes installed dependencies and private recovered session records. The original recovery archives remain the authoritative historical backup.
