#!/usr/bin/env python3
"""Validate and snapshot the existing private research database using SQLite backup."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile

def validate(path):
    with sqlite3.connect(f'file:{Path(path).resolve()}?mode=ro', uri=True) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('State integrity check failed')
        if db.execute('PRAGMA foreign_key_check').fetchone():
            raise ValueError('State has foreign key violations')
        counts = {t: db.execute('SELECT COUNT(*) FROM '+t).fetchone()[0]
                  for t in ('image_subject','image_requirement','image_candidate','image_registry')}
        if counts['image_subject'] < 27408 or counts['image_registry'] != counts['image_subject']:
            raise ValueError('Refusing incomplete or replacement state')
        if counts['image_requirement'] < 367794 or counts['image_candidate'] < 14479:
            raise ValueError('Historical requirements or candidates lost')
        return counts

def snapshot(source, output):
    validate(source)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    # Backup includes committed WAL pages; copying a live .sqlite file does not.
    with tempfile.TemporaryDirectory(dir=output.parent) as td:
        backup = Path(td)/'snapshot.sqlite'
        with sqlite3.connect(f'file:{Path(source).resolve()}?mode=ro', uri=True) as src:
            with sqlite3.connect(backup) as dest:
                src.backup(dest)
        counts = validate(backup)
        pending = output.with_suffix(output.suffix+'.pending')
        with backup.open('rb') as inp, gzip.open(pending,'wb',compresslevel=6) as out:
            while chunk := inp.read(1024*1024): out.write(chunk)
        pending.replace(output)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(output.suffix+'.sha256').write_text(digest+'  '+output.name+'\n')
    return {'sha256':digest,'counts':counts,'output':output.name}

if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source',type=Path)
    p.add_argument('--out',type=Path)
    a=p.parse_args()
    print(json.dumps(snapshot(a.source,a.out) if a.out else validate(a.source)))
