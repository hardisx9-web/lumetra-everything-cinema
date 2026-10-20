# Persistent image research — 2026-10-20

Continues source commit 415240760cc0632884d144ab2fc515ff9086a5ce and the full 2026-10-19 review database. The existing acquisition script and all prior candidate/review records are retained. Discovery never approves an image or changes the live website.

## GitHub authorization blocker

The connected GitHub service returned 404 for `hardisx9-web/lumetra-everything-cinema`; both account and installed-repository searches returned no Lumetra repository. This does not prove deletion. There is no authenticated GitHub CLI in this workspace. No GitHub workflow, release asset or schedule has been installed remotely.

Required owner action: open https://github.com/settings/installations, configure the GitHub app used by ChatGPT for the `hardisx9-web` account, and include the private `lumetra-everything-cinema` repository in its repository access. Reconnect GitHub in ChatGPT if required. If the repository has moved, provide its current private repository URL. Do not paste tokens into chat.

## Once access is granted

1. Verify the actual repository is private, inspect its current branch/history, and apply only this runner integration on a new branch. Do not replace the repository with the isolated preview source or push over its default branch.
2. Disable any older image research workflow before enabling this workflow; concurrent writers in separate workflow groups could lose state. Keep original deployment workflows manual and do not dispatch them.
3. Run `python3 scripts/state-bootstrap.py .sites-runtime/release-review.sqlite --out release-review.sqlite.gz`. It validates historical counts/integrity and uses SQLite backup to include committed WAL pages. Keep the resulting state and checksum private and outside Git.
4. With authenticated `gh` and the verified repository selected, create the private prerelease tag `lumetra-image-state` if absent, then upload `release-review.sqlite.gz` and `release-review.sqlite.gz.sha256` without overwriting any existing asset. If the tag already has state, compare and reconcile it before uploading. Never reset newer remote state to this checkpoint.
5. Put `.github/workflows/lumetra-image-research.yml` on the repository's default branch through the reviewed PR. GitHub schedules only default-branch workflows. Dispatch with `per_provider=1`, inspect actual run logs and state assets, then dispatch again and compare completed subject/provider pairs. A local test does not substitute for this GitHub-hosted test.
6. Enable Actions and permit the workflow's `contents: write` permission. The built-in GITHUB_TOKEN is used; no Cloudflare credentials are required. A Git push identity must be permitted to update workflow files. If the app cannot write workflows, the repository owner must apply the prepared workflow through a PR.

## Persistence and limits

Every six hours, 150 queries per provider run with a 6.5-second provider cadence. Manual input is limited to 1–250 per provider, passed as an environment variable and validated before arithmetic. Providers stop independently on their first error. Retry-After and durable provider cooldowns prevent immediate retries; successful per-provider progress skips completed searches after restart. `NO_MATCH_FOUND` means no result for one query, never exhaustive research.

State uploads are immutable, checksummed assets named with a UTC timestamp and attempt. Earlier state is never clobbered. Restore requires both an asset and its checksum, plus database integrity and historical-count checks. Failed/cancelled runs save committed progress when the runner is still allowed to execute cleanup; a hard runner loss can lose the current batch but cannot erase the previous checkpoint. Retries safely deduplicate candidates.

Release assets grow without automatic deletion. Review private storage and Actions-minute usage before sustained operation; the default schedule can use about 70+ runner minutes/day, more with slow requests. If a run repeatedly times out, reduce the batch. Do not purchase additional capacity without owner approval. The workflow's 40-minute acquisition limit leaves time for state upload inside its 60-minute job limit.

Metadata evidence is stored in each candidate; new candidates also embed response-check metadata. Preserve the discovery-cache directory with checkpoints for older records that reference cache paths. Candidate metadata can contain illustrations, unrelated results or unlicensed files: none may be displayed without separate exact identity, real-photograph and per-file rights review.

## Local continuation

`python3 scripts/run-image-discovery-v3.py --providers commons,loc --limit-per-provider 150 --delay 6.5 --db .sites-runtime/release-review.sqlite`

Run `python3 scripts/test-image-discovery-v3.py -q` and `python3 scripts/test-image-acquisition.py -q` for regression checks. The bundled Termux wrapper is retained as `docs/RUN_TERMUX.sh`; no phone connection was available or accessed in this session.

This integration does not modify Cloudflare, approve deployment, refresh viewing rights, publish editorial stubs, or change the three approved photographs. The existing release remains blocked pending its item-level and production QA gates.

## LOC adapter correction found during live validation

The supplied adapter called `/pictures/?fo=json&q=...`, which returned a collections homepage (`featured`, `collections`, `links`, `indexes`) rather than a search response. It previously treated missing `results` as no matches. The v3 adapter now uses the documented `/photos/?fo=json&c=8&q=...` search endpoint, validates response schema and refuses to mark malformed responses complete. Source: https://www.loc.gov/apis/json-and-yaml/requests/ . Twenty-seven affected subject/provider progress rows were reclassified for retry, preserving original attempt history and appending correction attempts. See `loc-adapter-correction.json` in the checkpoint for exact subjects and outcomes. These invalid homepage responses must never be counted as successful source research.
