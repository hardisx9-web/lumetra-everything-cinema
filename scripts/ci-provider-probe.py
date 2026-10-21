#!/usr/bin/env python3
"""Real provider probe on public runners; never loads or publishes private state."""
import importlib.util
import json
from pathlib import Path

spec=importlib.util.spec_from_file_location('discovery',Path(__file__).with_name('run-image-discovery-v3.py'))
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
results=[]
for provider in runner.PROVIDERS:
    subject='technology/cameras/arri-alexa-35'
    result=runner.discover_one((subject,'ARRI ALEXA 35','technology'),provider)
    results.append({'provider':provider,'subject':subject,'outcome':result[3],
                    'candidate_count':len(result[4]),'error':result[6],
                    'private_database_loaded':False,'images_approved':0})
report={'scope':'Live provider discovery only; private checkpoint acquisition/resume NOT tested',
        'results':results}
Path('.sites-runtime').mkdir(exist_ok=True)
Path('.sites-runtime/provider-probe.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
raise SystemExit(0 if all(r['outcome']!='TRANSIENT_FAILURE' for r in results) else 2)
