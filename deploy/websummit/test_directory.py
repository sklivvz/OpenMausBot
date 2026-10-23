import importlib.util
import json
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('directory', Path(__file__).with_name('directory.py'))
directory = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(directory)

PROFILE = 'https://attend.websummit.com/lis26/profiles/11111111-1111-4111-8111-111111111111'


class DirectoryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest = {'event': 'lis26', 'sources': [{'kind': 'company', 'path': 'companies.csv', 'format': 'csv'}], 'reported_totals': {'company': 1}}
        self.write('companies.csv', 'ws_company_id,name,category,country,industry,website_domain\n123,Acme Ltd,Startup,EE,Software,www.acme.example\n')

    def write(self, name, value):
        (self.root / name).write_text(value)

    def test_actual_export_columns_and_domain_normalization(self):
        records, report = directory.build(self.manifest, self.root)
        self.assertEqual(records['records'][0]['variants'][0]['domain'], 'acme.example')
        self.assertEqual(report['coverage'][1]['provider_completeness'], 'unverified')
        self.assertEqual(report['coverage'][1]['difference_from_reported_total'], 0)
        self.assertFalse(report['coverage'][1]['reported_total_verified'])

    def test_people_dedup_profiles_across_export_sweeps(self):
        self.write('one.tsv', 'account\tcountry\tname\ttitle\tprofile_url\nAcme Ltd\tEE\tJane Example\tCTO\t' + PROFILE + '\n')
        self.write('two.tsv', 'company\tcountry\tname\ttitle\tprofile_url\nAcme Ltd\tEE\tJane Example\tCTO\t' + PROFILE + '\n')
        self.manifest['sources'] = [{'kind': 'person', 'path': name, 'format': 'tsv'} for name in ('one.tsv', 'two.tsv')]
        records, report = directory.build(self.manifest, self.root)
        self.assertEqual(report['unique_records'], 1)
        self.assertEqual(report['duplicate_rows'], 1)
        self.assertEqual(len(records['records'][0]['evidence']), 2)
        self.assertEqual(records['records'][0]['conflicting_fields'], [])
        result = directory.match(records, [{'id': 'p', 'kind': 'person', 'profile_url': PROFILE}])[0]
        self.assertEqual(result['status'], 'exact_match')
        self.assertFalse(result['attendance_verified'])

    def test_conflicting_source_variants_are_never_silently_selected(self):
        self.write('other.csv', 'ws_company_id,name,category,country,industry,website_domain\n123,Other Corp,Startup,EE,Software,other.example\n')
        self.manifest['sources'].append({'kind': 'company', 'path': 'other.csv', 'format': 'csv'})
        records, report = directory.build(self.manifest, self.root)
        self.assertEqual(report['coverage'][1]['conflicting_ids'], 1)
        self.assertEqual(directory.match(records, [{'id': 'q', 'kind': 'company', 'domain': 'acme.example'}])[0]['status'], 'uncertain')
        crossed = directory.match(records, [{'id': 'q', 'kind': 'company', 'domain': 'acme.example', 'name': 'Other Corp'}])[0]
        self.assertEqual(crossed['candidates'], [])
        self.assertEqual(crossed['partial_match_keys'], ['company:123'])

    def test_ambiguous_domains_and_no_fuzzy_suffix_match(self):
        self.write('companies.csv', 'ws_company_id,name,category,country,industry,website_domain\n123,Acme Ltd,Startup,EE,Software,acme.example\n456,Acme US,Startup,US,Software,acme.example\n')
        records, _ = directory.build(self.manifest, self.root)
        outcomes = directory.match(records, [{'id': 'domain', 'kind': 'company', 'domain': 'https://www.acme.example/'}, {'id': 'name', 'kind': 'company', 'name': 'Acme'}, {'id': 'exact', 'kind': 'company', 'name': ' acme LTD '}])
        self.assertEqual([r['status'] for r in outcomes], ['uncertain', 'uncertain', 'exact_match'])
        self.assertIn('absence_not_established', outcomes[1]['reason'])

    def test_headerless_people_and_bad_profile_are_reported(self):
        self.write('people.tsv', 'name\tcompany\tprofile_url\nJane Example\tAcme\thttps://evil.example/lis26/profiles/11111111-1111-4111-8111-111111111111\n')
        self.manifest['sources'] = [{'kind': 'person', 'path': 'people.tsv', 'format': 'tsv'}]
        records, report = directory.build(self.manifest, self.root)
        self.assertEqual(records['records'], [])
        self.assertEqual(len(report['rejected_rows']), 1)
        self.write('people.tsv', 'Unknown\tAcme\t' + PROFILE + '\nOther\tAcme\t' + PROFILE + '\n')
        with self.assertRaisesRegex(ValueError, 'Unrecognized people export headers'):
            directory.build(self.manifest, self.root)

    def test_csv_quoting_bom_crlf_and_invalid_structure(self):
        self.write('companies.csv', '\ufeffws_company_id,name,category,country,industry,website_domain\r\n123,"Acme, Ltd",Startup,EE,"Software\nSystems",acme.example\r\n')
        records, _ = directory.build(self.manifest, self.root)
        self.assertEqual(records['records'][0]['variants'][0]['name'], 'Acme, Ltd')
        for data in (b'a,a\n1,2\n', b'a,b\n1,2,3\n', b'a,b\n1\n'):
            with self.assertRaises(ValueError):
                directory.parse_rows(data, 'csv')

    def test_input_bounds_path_traversal_and_symlink(self):
        for path in ('../companies.csv', str(self.root / 'companies.csv')):
            with self.assertRaises(ValueError):
                directory.load_file(self.root, path)
        (self.root / 'alias.csv').symlink_to(self.root / 'companies.csv')
        with self.assertRaises(ValueError):
            directory.load_file(self.root, 'alias.csv')
        old_limit = directory.MAX_FILE
        try:
            directory.MAX_FILE = 2
            with self.assertRaises(ValueError):
                directory.load_file(self.root, 'companies.csv')
        finally:
            directory.MAX_FILE = old_limit

    def test_domain_and_profile_boundaries(self):
        for value in ('http://user:pass@acme.example', 'https://acme.example/path', 'localhost', '127.0.0.1', 'acme.example:443', 'acme.example?token=secret'):
            with self.assertRaises(ValueError):
                directory.domain(value)
        for value in (PROFILE.replace('lis26', 'lis25'), PROFILE + '?token=secret', PROFILE.replace('https:', 'http:')):
            with self.assertRaises(ValueError):
                directory.profile(value, 'lis26')

    def test_json_contract_and_person_name_is_candidate_not_identity(self):
        self.write('people.json', json.dumps([{'name': 'Jane Example', 'company': 'Acme Ltd', 'profile_url': PROFILE}]))
        self.manifest['sources'] = [{'kind': 'person', 'path': 'people.json', 'format': 'json'}]
        records, _ = directory.build(self.manifest, self.root)
        result = directory.match(records, [{'id': 'q', 'kind': 'person', 'name': 'Jane Example', 'company': 'Acme Ltd'}])[0]
        self.assertEqual(result['status'], 'exact_candidate')
        with self.assertRaises(ValueError):
            directory.match(records, [{'id': 'q', 'kind': 'person'}])

    def test_result_limits_preserve_true_counts(self):
        rows = [{'id': str(number), 'name': 'Shared Name', 'domain': 'shared.example'} for number in range(150)]
        self.write('many.json', json.dumps(rows))
        self.manifest['sources'] = [{'kind': 'company', 'path': 'many.json', 'format': 'json'}]
        records, _ = directory.build(self.manifest, self.root)
        result = directory.match(records, [{'id': 'q', 'kind': 'company', 'domain': 'shared.example'}])[0]
        self.assertEqual(result['candidate_count'], 150)
        self.assertEqual(len(result['candidates']), 100)
        self.assertTrue(result['results_truncated'])
        self.assertEqual(result['status'], 'uncertain')

    def test_cli_synthetic_workflow_and_nonoverwrite(self):
        self.manifest['prospects'] = [{'id': 'acme', 'kind': 'company', 'domain': 'acme.example'}]
        self.write('manifest.json', json.dumps(self.manifest))
        command = [sys.executable, str(Path(directory.__file__)), '--manifest', str(self.root / 'manifest.json'), '--output', str(self.root / 'out')]
        result = subprocess.run(command, capture_output=True, text=True, check=True)
        summary = json.loads(result.stdout)
        self.assertEqual(summary['unique_records'], 1)
        self.assertNotIn('Acme', result.stdout)
        self.assertEqual(stat.S_IMODE((self.root / 'out').stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((self.root / 'out/matches.json').stat().st_mode), 0o600)
        self.assertEqual(json.loads((self.root / 'out/matches.json').read_text())[0]['status'], 'exact_match')
        before = (self.root / 'out/report.json').read_bytes()
        repeated = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(repeated.returncode, 2)
        self.assertEqual(before, (self.root / 'out/report.json').read_bytes())


if __name__ == '__main__':
    unittest.main()
