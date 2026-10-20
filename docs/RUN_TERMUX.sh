#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
# Run from project SOURCE directory with patch scripts installed.
# e.g. cd ~/lumetra-predeployment/source; bash /path/to/RUN_TERMUX.sh
ROOT="$(pwd)"; DB="$ROOT/.sites-runtime/release-review.sqlite";
if [ ! -s "$DB" ]; then echo "Missing Work review state: $DB" >&2; exit 2; fi
mkdir -p .sites-runtime/logs
python3 scripts/test-image-discovery-v3.py -q
while :; do
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  log=".sites-runtime/logs/$stamp.jsonl"
  python3 scripts/run-image-discovery-v3.py --providers commons,loc --limit-per-provider 150 --delay 6.5 --db "$DB" > "$log" 2>&1 || true
  tail -3 "$log"
  # Safe atomic copy snapshot before next batch; no hard reset of the source DB.
  python3 - "$DB" <<'PYDB'
import sqlite3,sys
c=sqlite3.connect(sys.argv[1]); c.execute('pragma wal_checkpoint(PASSIVE)'); c.close()
PYDB
  # If provider is offline, avoid burning time and battery in a tight retry loop.
  if grep -q '"failures": [1-9]' "$log"; then echo 'Provider unavailable. Pausing 30 minutes.'; sleep 1800;
  else sleep 60; fi
done
