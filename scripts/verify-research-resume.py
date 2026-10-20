#!/usr/bin/env python3
"""Read-only proof that historical review records survived a resumed acquisition run."""
import argparse
import importlib.util
import json
from pathlib import Path
import sqlite3

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline',required=True,type=Path)
parser.add_argument('--current',required=True,type=Path)
args=parser.parse_args()
spec=importlib.util.spec_from_file_location('discovery',Path(__file__).with_name('run-image-discovery-v3.py'))
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
db=sqlite3.connect(f'file:{args.current.resolve()}?mode=ro',uri=True)
db.execute('ATTACH DATABASE ? AS original',(f'file:{args.baseline.resolve()}?mode=ro',))
preserved={}
for table in ('image_subject','image_requirement','image_registry','image_candidate'):
    missing=db.execute(f'SELECT count(*) FROM (SELECT * FROM original.{table} EXCEPT SELECT * FROM main.{table})').fetchone()[0]
    if missing:raise SystemExit(f'{table}: {missing} historical rows missing or changed')
    preserved[table]=db.execute(f'SELECT count(*) FROM original.{table}').fetchone()[0]
pairs=db.execute('SELECT canonical_subject_id,provider,outcome FROM image_provider_progress').fetchall()
if not pairs:raise SystemExit('No persisted provider progress')
selected={p:[r[0] for r in runner.choose(db,p,5)] for p in runner.PROVIDERS}
completed={(s,p) for s,p,outcome in pairs if outcome!='TRANSIENT_FAILURE'}
for provider,subjects in selected.items():
    if any((subject,provider) in completed for subject in subjects):
        raise SystemExit('Completed provider search selected again after database reopen')
before=preserved['image_candidate']
after=db.execute('SELECT count(*) FROM image_candidate').fetchone()[0]
print(json.dumps({'status':'PASS','historical_rows_preserved':preserved,
    'persisted_provider_checks':len(pairs),'candidates_before':before,'candidates_after':after,
    'new_candidates':after-before,'next_batch_first_subjects':selected,
    'note':'Read-only reopen proof; no identity/rights approvals or GitHub-hosted execution implied'},indent=2))
