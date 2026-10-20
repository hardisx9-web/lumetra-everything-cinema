#!/usr/bin/env python3
"""Offline regression coverage for the provider-independent, no-false-approval runner."""
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
P=Path(__file__).with_name('run-image-discovery-v3.py')
spec=importlib.util.spec_from_file_location('runner_v2',P)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class DiscoveryV3(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.db=sqlite3.connect(Path(self.tmp.name)/'state.db')
  self.db.executescript('''CREATE TABLE image_subject(canonical_subject_id TEXT PRIMARY KEY,subject_type TEXT);
  CREATE TABLE acquisition_queue(canonical_subject_id TEXT PRIMARY KEY,search_query TEXT,provider TEXT,status TEXT,attempts INT,last_error TEXT);
  CREATE TABLE image_registry(canonical_subject_id TEXT PRIMARY KEY,status TEXT);
  CREATE TABLE image_candidate(candidate_id TEXT PRIMARY KEY,canonical_subject_id TEXT,candidate_url TEXT,source_page TEXT,source_provider TEXT,status TEXT,metadata_json TEXT);
  CREATE TABLE acquisition_attempt(id INTEGER PRIMARY KEY,canonical_subject_id TEXT,provider TEXT,attempted_at TEXT,http_status INT,outcome TEXT,evidence_path TEXT,error_reason TEXT);
  INSERT INTO image_subject VALUES('technology/lenses/prime','technology');
  INSERT INTO acquisition_queue VALUES('technology/lenses/prime','prime lens photograph','commons','REVIEW_REQUIRED',1,NULL);
  INSERT INTO image_registry VALUES('technology/lenses/prime','IDENTITY_PENDING');''')
  mod.init(self.db)
 def tearDown(self):self.db.close();self.tmp.cleanup()
 def test_each_provider_even_when_old_queue_marked_review(self):
  self.assertEqual(len(mod.choose(self.db,'commons',100)),1)
  self.assertEqual(len(mod.choose(self.db,'loc',100)),1)
  mod.process(self.db,'technology/lenses/prime','commons',mod.utc(),'NO_MATCH_FOUND',[],'cache',None)
  self.assertEqual(len(mod.choose(self.db,'commons',100)),0)
  self.assertEqual(len(mod.choose(self.db,'loc',100)),1)
 def test_preserves_review_gate_and_avoids_duplicate(self):
  row=('c1','technology/lenses/prime','https://upload.wikimedia.org/x.png','https://commons.wikimedia.org/wiki/File:x.png','commons','IDENTITY_AND_RIGHTS_REVIEW_REQUIRED','{}')
  mod.process(self.db,'technology/lenses/prime','commons',mod.utc(),'CANDIDATES_RECORDED',[row],'cache',None)
  self.assertEqual(self.db.execute('select status from image_registry').fetchone()[0],'IDENTITY_PENDING')
  self.assertEqual(self.db.execute('select status from image_candidate').fetchone()[0],'IDENTITY_AND_RIGHTS_REVIEW_REQUIRED')
  self.assertEqual(len(mod.choose(self.db,'loc',100)),1)
 def test_temporary_failure_only_pauses_one_provider(self):
  mod.process(self.db,'technology/lenses/prime','commons',mod.utc(),'TRANSIENT_FAILURE',[],None,'DNS unavailable')
  self.assertEqual(len(mod.choose(self.db,'commons',100)),0)
  self.assertEqual(len(mod.choose(self.db,'loc',100)),1)
 def test_provider_fail_fast_and_other_provider_continues(self):
  calls=[]
  def fake(row,provider):
   calls.append((row[0],provider)); return (row[0],provider,mod.utc(),'TRANSIENT_FAILURE',[],None,'DNS failure')
  # two subjects; failing one provider must not exhaust the queue.
  self.db.execute("INSERT INTO image_subject VALUES('film/example','film')")
  self.db.execute("INSERT INTO acquisition_queue VALUES('film/example','film example','commons','QUEUED',0,NULL)")
  self.db.execute("INSERT INTO image_registry VALUES('film/example','IDENTITY_PENDING')")
  with patch.object(mod,'discover_one',side_effect=fake),patch('time.sleep',return_value=None):
   rc=mod.run(self.db,['commons','loc'],10,6.5)
  self.assertEqual(rc,2)
  self.assertEqual(len(calls),2)
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM image_registry WHERE status='IDENTITY_PENDING'").fetchone()[0],2)
 def test_only_exact_https_metadata_candidates(self):
  payload={'query':{'pages':[{'imageinfo':[{'url':'https://upload.wikimedia.org/x.jpg','descriptionurl':'https://commons.wikimedia.org/wiki/File:x'}]},{'imageinfo':[{'url':'http://bad.example/z.jpg','descriptionurl':'https://commons.wikimedia.org/wiki/File:z'}]}]}}
  self.assertEqual(len(list(mod.normalize(payload,'commons'))),1)

class PersistentDiscovery(unittest.TestCase):
 setUp=DiscoveryV3.setUp
 tearDown=DiscoveryV3.tearDown
 def test_restart_skips_completed_provider_without_losing_candidates(self):
  row=('persisted','technology/lenses/prime','https://upload.wikimedia.org/x.jpg','https://commons.wikimedia.org/wiki/File:x','commons','IDENTITY_AND_RIGHTS_REVIEW_REQUIRED','{}')
  mod.process(self.db,'technology/lenses/prime','commons',mod.utc(),'CANDIDATES_RECORDED',[row],'cache',None)
  path=self.db.execute('PRAGMA database_list').fetchone()[2]
  self.db.close();self.db=sqlite3.connect(path);mod.init(self.db)
  self.assertEqual(mod.choose(self.db,'commons',10),[])
  self.assertEqual(len(mod.choose(self.db,'loc',10)),1)
  self.assertEqual(self.db.execute('SELECT count(*) FROM image_candidate').fetchone()[0],1)
  mod.process(self.db,'technology/lenses/prime','commons',mod.utc(),'CANDIDATES_RECORDED',[row],'cache',None)
  self.assertEqual(self.db.execute('SELECT candidates_added FROM image_provider_progress').fetchone()[0],0)
 def test_retry_after_pauses_entire_provider_across_restart(self):
  mod.process(self.db,'technology/lenses/prime','commons',mod.utc(),'TRANSIENT_FAILURE',[],None,{'reason':'HTTP 429','retry_seconds':7200,'http_status':429})
  hold=self.db.execute("SELECT not_before FROM provider_checkpoint WHERE provider='commons'").fetchone()[0]
  self.assertGreater(hold,mod.later(119))
  self.assertEqual(mod.choose(self.db,'commons',10),[])
  self.assertEqual(len(mod.choose(self.db,'loc',10)),1)
 def test_loc_uses_documented_search_endpoint(self):
  url=mod.query_url('ARRI Alexa 35','loc')
  self.assertTrue(url.startswith('https://www.loc.gov/photos/?'))
  self.assertIn('q=ARRI+Alexa+35',url)
 def test_invalid_api_response_not_marked_no_match(self):
  for payload,provider in [({},'loc'),({'error':{}},'commons'),({'status':503},'commons')]:
   with self.assertRaises(ValueError):list(mod.normalize(payload,provider))

if __name__=='__main__':unittest.main()
