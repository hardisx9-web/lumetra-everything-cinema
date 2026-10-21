# Exact recovery history

`Lumetra-Recovery-History.bundle` preserves all seven recovery commits through
8012235a0e7d17267f5c1b45d9cfaa4dad2081fb with their original object IDs, authors,
messages and timestamps. It contains source history only: no SQLite state or
metadata cache. The development branch is based on the existing original
Cloudflare-era repository head ca673de9dea0a40b0979737ee506d84f93dc7a42.

The GitHub connection supports Git data writes but does not provide authenticated
native Git push. The development snapshot carries this exact bundle. The public-safe Actions
workflow imports those original commits and attaches them as a second parent
without changing the application tree, then fast-forward pushes only this new
development branch. It verifies the exact recovery head, skips an already
imported history and never force pushes. Restore independently with:

    git clone .recovery/Lumetra-Recovery-History.bundle recovered-history

Do not put research databases, state backups, discovery caches, execution reports
containing research state, or credentials in this public repository or its releases.
The private 2026-10-20 checkpoint retains 14,632 candidates, including the 153 new
candidates. It is deliberately separate from application source.
