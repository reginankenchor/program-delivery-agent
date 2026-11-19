"""Build validation tests, not model inference tests."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('site_builder', ROOT / 'scripts/build_site.py')
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)

class SiteBuildTests(unittest.TestCase):
    def setUp(self):
        self.report = json.loads((ROOT / 'site/data/latest-report.json').read_text())
        self.report.pop('provenance')
        for p in self.report['projects']:
            # Synthetic event for build tests, not portfolio evidence.
            p['trace'] = [{'model_message': {'content': 'build-test-only'}}]

    def test_build_preserves_report_and_copies_assets(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as temp:
            source, output = Path(temp) / 'report.json', Path(temp) / 'built'
            source.write_text(json.dumps(self.report))
            builder.build(source, output)
            self.assertEqual(json.loads((output / 'data/latest-report.json').read_text()), self.report)
            for f in ['index.html','styles.css','app.js','model.mjs','.nojekyll']:
                self.assertTrue((output / f).exists())

    def test_stub_failed_summary_and_traceless_reports_rejected(self):
        for mutate in [lambda r:r.update(model='unit-test-stub'),lambda r:r.update(passed=False),lambda r:r.update(provenance={'source_type':'shared_run_summary'}),lambda r:r['projects'][0].update(trace=[])]:
            r=copy.deepcopy(self.report)
            mutate(r)
            with self.assertRaises(ValueError):
                builder.validate_input(r)

    def test_source_and_existing_files_not_overwritten(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as temp:
            source=Path(temp)/'report.json'
            source.write_text(json.dumps(self.report))
            output=Path(temp)/'occupied'
            output.mkdir()
            (output/'keep.txt').write_text('keep')
            for target in [ROOT,ROOT/'site',output]:
                with self.assertRaises(ValueError): builder.build(source,target)
            self.assertEqual((output/'keep.txt').read_text(),'keep')

if __name__ == '__main__': unittest.main()
