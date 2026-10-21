#!/usr/bin/env python3
"""Snapshot the existing Work state and emit its checksum; never initialize a replacement."""
import argparse, importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('research_state',Path(__file__).with_name('research-state.py'))
state=importlib.util.module_from_spec(spec);spec.loader.exec_module(state)
p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('--out',type=Path,default=Path('release-review.sqlite.gz'));a=p.parse_args()
print(state.snapshot(a.source,a.out))
