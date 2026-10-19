# LUMETRA — Big Release Candidate V3

**Date:** 18 October 2026  
**Release decision: NOT READY FOR PUBLIC LAUNCH.**  
**Purpose:** Recovered Lumetra source, integrated editorial/retention upgrade, automated checks and non-destructive preview. The current Cloudflare Worker and original Termux source have not been modified.

## What is implemented and tested

| Product area | State | Evidence |
|---|---|---|
| Restored film catalogue | Working in isolated SQLite preview | `/api/stats` returns **20,512** work records; full-text search works. |
| Cinema intro / film-world engine | Preserved | Existing assets, original video, responsive/reduced-motion and WebGL-fallback code retained. Browser rendering still requires physical device validation. |
| Missing-poster treatment | Implemented | Eight film-specific original illustrative variants, with clear labels; verified archival art takes priority. No unlicensed film posters created. |
| Editorial depth | Expanded | Nine features of at least 500 words, containing multiple sections and linked institutional references; remaining shorter essays labeled accordingly. These are **research drafts**, not peer-reviewed scholarship. |
| Film dossiers | Partial | Four curated films have source-linked research sections; the larger catalogue remains metadata-first. |
| Discovery facets | Implemented with inherited metadata | Title/director/country/year plus genre and language filters; 80 most common raw genre/language labels offered, with data normalization still required. |
| Personal retention | Implemented in browser source | My Cinema: save/unsave, mark watched, save research, local JSON export/import, input validation. Data stays in browser localStorage with no accounts. |
| Viewing rights and source health | **BLOCKED** | Current source-publication gate yields **zero** eligible free viewing films. A film listing cannot imply playback rights. |
| Preview API | Working | 12 shell/media/API smoke paths, editorial API, film records, programming and search return success locally. |
| Automated source checks | Passing | 24 source/artwork policy checks; 11 catalogue/programming checks; notebook, editorial, responsive and route contracts; local E2E tests pass with stale-source warning. |
| Visual browser QA | **BLOCKED** | Chromium browser policy prevented localhost navigation (`ERR_BLOCKED_BY_ADMINISTRATOR`). Independent Android, desktop, screenreader and Lighthouse runs are required. |
| Production framework build | **NOT VERIFIED** | Offline source checkout has no `node_modules/vinext` and package registry could not be reached. GitHub Actions with dependency installation must verify the build. |
| GitHub integration | **BLOCKED** | Connected integration can see JobPilot and MIXLAB AI, but not the original Lumetra repository. No push attempted. |
| Cloudflare staging / D1 | **NOT VERIFIED** | Configuration for `lumetra-cinema-staging` is retained, but remote credentials, database state and deployment health are not independently checked. |

## Launch-critical tasks (ordered)

1. **Restore GitHub source of truth.** Confirm `hardisx9-web/lumetra-everything-cinema` exists and connect access to that repository; otherwise deliberately create a *new private* Lumetra repository and agree on its name. Preserve JobPilot/MIXLAB, never force push.
2. **Rebuild and exercise actual production worker** on a clean runner with lockfile-frozen dependencies. Resolve failures by inspecting logs. Run lint/typechecks, database migrations against disposable test D1 and a preview deployment, not production.
3. **Restore living viewing availability.** Inspect preserved ingestion workers, consent/terms, last verification timestamps and rate limits; reverify official films and territories. Maintain expiry gates; never hard-code ``watchable=true`` to fake a launch.
4. **Research and artwork enrichment at scale.** Prioritize 100 signature film dossiers with verified cast, original title, year, festival history and production/restoration evidence; expand long-form editorial library across regions, genres and the present day. Obtain rights-aware posters or use clearly marked Lumetra illustrations.
5. **Editorial quality control.** Human specialist review of nine research drafts and factual citations, licensing records, correction queue, broken links and dated sources.
6. **End-to-end product QA.** Android + desktop Safari/Chrome/Firefox, keyboard, screen reader, contrast, motion preference, large text, slow network, offline states, empty results and browser storage denial.
7. **Security/privacy and operations.** No credentials in repository or archives; verify Cloudflare/GitHub secrets via secure settings, rate limiting, protections, backup/restore, monitoring, takedown and incident process.
8. **Performance.** Target mobile p75 LCP <=2.5s, INP <=200ms and CLS <=0.1; measure Lighthouse/lab and real field data rather than asserting results from local API latency.
9. **Deploy to staging** with rollback, QA and explicit user approval. Only then promote to production using the existing Worker and D1 identity if verified.

## Competitive positioning

Netflix primarily offers subscription viewing and personalized recommendations. IMDb offers millions of film and TV records, user ratings, watchlists, reviews and community lists. Lumetra must not imply it has their licensed catalogues, infrastructure, contributor community or market share. Its realistic differentiation is in **research depth, source trails, international cinema, archival integrity, immersive discovery and transparent legal viewing pathways**. The first public launch should demonstrate that value intensely rather than claim parity.

## Reference institutions used in research

- BFI: https://www.bfi.org.uk/
- Film Foundation World Cinema Project: https://www.film-foundation.org/world-cinema
- National Film Board of Canada: https://www.nfb.ca/
- Library of Congress: https://www.loc.gov/
- FIAF: https://www.fiafnet.org/

## Recovery and rollback

The original five Lumetra recovery ZIPs and manifest remain in the ChatGPT Library under `/Lumetra/Recovery-2026-10-18/`. The V1 and V2 preview snapshots remain separately preserved. V3 source is an isolated copy. No GitHub commits, Cloudflare deployments, database schema mutations, or secret changes were made by this release preparation. To reject V3, simply retain the previous source; do not apply this candidate.
