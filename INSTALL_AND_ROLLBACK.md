# Lumetra V3 — Integrate on a new branch, do not overwrite production

The full-source ZIP is a clean copy from the recovered Termux tree plus reviewed V1/V2/V3 source enhancements. It deliberately excludes dependencies, caches, `.git`, `.env*`, `.npmrc`, local server runtime data and credentials. The original 5-volume recovery and Git history are preserved separately in ChatGPT Library.

## On a computer with Node 24/pnpm and Git

1. Verify this ZIP's checksum, unzip to a NEW folder. Do not extract over the active repository.
2. Audit all files and compare against the source commit `ca673de9dea0a40b0979737ee506d84f93dc7a42` from `feature/cinematic-reconstruction` before merging. Preserve the 9 modified and 2 untracked files present in the recovered original.
3. In a fresh clone of the confirmed original GitHub repository, create a new feature branch, e.g. `feature/lumetra-release-v3`. Do not force-push or change main.
4. Copy the intended V3 files into that branch with a reviewable diff. `pnpm install --frozen-lockfile`, run existing tests plus `node scripts/test-editorial-depth.mjs`, `node scripts/test-launch-readiness.mjs`, `node scripts/test-my-cinema.mjs`, then `pnpm run build`.
5. Configure Cloudflare account secrets in GitHub's protected settings, not source control. Preserve the existing `wrangler.staging.toml` identity and D1 binding.
6. Use the manual staging deployment workflow only after test passes; validate actual remote D1 migration state, media assets, browser interactivity and the source-verification pipeline. Then run `LUMETRA_BASE_URL=https://<actual-staging-host> node scripts/release-gate.mjs`.
7. If staging fails, redeploy its previous successful commit and use a verified database rollback/snapshot strategy; do **not** drop or reset D1 as a shortcut.

## Known limits

No active GitHub repository access was available to ChatGPT in this session, and the environment did not contain the full Node `vinext` dependency or internet registry access. This is not a verified production build. The absence of an active free-viewing source currently blocks the release gate. The original live Worker was not touched.
