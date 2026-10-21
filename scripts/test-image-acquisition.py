import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('acquisition',Path(__file__).with_name('acquire-authentic-images.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class AcquisitionSafety(unittest.TestCase):
    def test_untrusted_destinations_and_credentials_fail_closed(self):
        for url in ['http://upload.wikimedia.org/a.jpg','https://127.0.0.1/a','https://commons.wikimedia.org.evil.invalid/a','https://user:pass@commons.wikimedia.org/a','https://commons.wikimedia.org:8443/a','https://commons.wikimedia.org/a?token=private']:
            with self.assertRaises(ValueError):module.safe_url(url)
    def test_registered_https_metadata_destination_is_allowed(self):
        self.assertEqual(module.safe_url('https://commons.wikimedia.org/w/api.php?action=query').hostname,'commons.wikimedia.org')
    def test_no_download_before_explicit_identity_and_rights_review(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'test.sqlite';db=sqlite3.connect(path)
            db.execute('CREATE TABLE image_candidate(candidate_id TEXT PRIMARY KEY,metadata_json TEXT)')
            db.execute('INSERT INTO image_candidate VALUES(?,?)',('unreviewed','{}'));db.commit();db.close()
            prior=module.STATE;module.STATE=path
            try:
                with self.assertRaisesRegex(ValueError,'EXPLICIT_ITEM_IDENTITY_AND_RIGHTS_REVIEW_REQUIRED'):module.download('unreviewed')
            finally:module.STATE=prior

if __name__=='__main__':unittest.main()
