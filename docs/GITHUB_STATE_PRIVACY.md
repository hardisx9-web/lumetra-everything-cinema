# GitHub acquisition activation — privacy gate

The repository was confirmed public on 2026-10-21. The development branch contains
application source and exact source-history recovery material only. It excludes
the private research SQLite database, discovery caches, latest candidate exports,
state backups and credentials. All 153 newly discovered candidates remain in the
private durable 2026-10-20 checkpoint (14,632 candidates total).

The current image-research workflow is manual-only, with its existing private-repo
guard retained. The previous schedule is disabled. The separate provider-probe
workflow performs live discovery from public equipment search terms and exports
only a public-safe summary. It never opens private state. Its success is not a
claim of stateful batch acquisition or cross-run private-state durability.

Required privacy decision before stateful acquisition: authorize changing this
repository to private, or authorize a separate private state store with narrowly
scoped runner access. Releases and Actions artifacts in this public repository
are not suitable for the private research database. No database has been uploaded.

If this repository becomes private, bootstrap the validated checkpoint as a
private release asset and checksum, dispatch a small batch twice, compare
subject/provider progress and candidate preservation, then enable the six-hour
schedule on the default branch. Enabling schedules requires the workflow on that
branch; a development-branch workflow alone does not schedule background runs.
Do not overwrite newer state. Keep all earlier immutable state assets. Validate
repository privacy again before every state read and write.

Neither workflow deploys Cloudflare. Existing deployment workflows stay manual
or retain their original triggers; this development branch does not activate
Cloudflare deployment. Do not merge or dispatch deployment workflows without
explicit owner approval.
