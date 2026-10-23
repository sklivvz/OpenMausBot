import csv
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('slush_offline', Path(__file__).with_name('offline.py'))
slush = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(slush)


class OfflineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.sources = []

    def tearDown(self):
        self.tmp.cleanup()

    def source(self, kind, rows, captured='2026-10-21T10:00:00Z', account='owner', event='slush26'):
        sid = str(len(self.sources))
        path = self.root / sid
        if kind in slush.HEADERS:
            with path.open('w') as f:
                writer = csv.DictWriter(f, fieldnames=slush.HEADERS[kind], delimiter='\t')
                writer.writeheader()
                writer.writerows(rows)
        else:
            path.write_text(json.dumps(rows))
        self.sources.append({'id': sid, 'kind': kind, 'path': sid, 'captured_at': captured, 'account': account, 'event': event})
        return path

    def run_report(self, **kwargs):
        return slush.run({'version': 1, 'sources': self.sources, **kwargs}, self.root)

    def meeting(self, **kwargs):
        return {'meeting_id': 'meeting-1', 'status': 'Accepted meetings',
                'start': '2026-11-19T08:30:00Z', 'end': '2026-11-19T08:55:00Z',
                'source_ref': 'synthetic meeting detail', **kwargs}

    def test_actual_sent_schema_keeps_requests_and_times_unconfirmed(self):
        self.source('sent_requests', [{'person': 'A Person', 'role_company': 'Example', 'type': 'sales', 'slots_offered': 'Nov 18 8:30/9:30/10:00'}])
        report = self.run_report()
        row = report['records'][0]
        self.assertEqual(row['status'], 'sent_claim')
        self.assertFalse(row['accepted_time_consistent'])
        self.assertEqual(row['interval']['state'], 'unknown')
        self.assertEqual(report['summary']['directory_completeness'], 'unknown')

    def test_exact_rows_dedup_without_merging_names(self):
        base = {'account': 'Prospect', 'slush_company': 'Example', 'match': 'exact', 'company_type': 'vc-investor', 'country': 'GB', 'name': 'A', 'title': 'Partner'}
        self.source('company_matches', [base, base, {**base, 'name': 'B'}])
        report = self.run_report(filters={'country': 'gb', 'company_contains': 'EXAMP'})
        self.assertEqual(len(report['records']), 2)
        self.assertEqual(report['summary']['exact_duplicate_rows'], 1)
        self.assertEqual(len(report['filtered_company_record_ids']), 2)
        self.assertEqual(len(report['records'][0]['provenance']), 2)
        self.assertEqual(report['records'][0]['identity_state'], 'no_provider_id')

    def test_contacts_preserve_claims_and_conflicting_details(self):
        base = {k: '' for k in slush.HEADERS['contacts']}
        base.update(person='A', fund='Fund', email='a@example.test', email_status='unverified')
        self.source('contacts', [base, {**base, 'email': 'b@example.test'}])
        report = self.run_report()
        self.assertEqual(len(report['records']), 2)
        self.assertEqual(report['records'][0]['raw']['email_status'], 'unverified')

    def test_same_instant_in_two_timezones_reconciles(self):
        self.source('meeting_observations', [self.meeting()])
        self.source('meeting_observations', [self.meeting(start='2026-11-19T10:30:00', end='2026-11-19T10:55:00', timezone='Europe/Helsinki', timezone_source='synthetic platform timezone setting')])
        meeting = self.run_report()['meetings'][0]
        self.assertTrue(meeting['accepted_time_consistent'])
        self.assertEqual(len(meeting['current_evidence']), 2)

    def test_two_hour_disagreement_is_not_resolved_by_guessing(self):
        self.source('meeting_observations', [self.meeting(), self.meeting(start='2026-11-19T10:30:00Z', end='2026-11-19T10:55:00Z')])
        meeting = self.run_report()['meetings'][0]
        self.assertEqual(meeting['interval']['state'], 'unknown')
        self.assertFalse(meeting['accepted_time_consistent'])

    def test_missing_zone_offset_disagreement_and_dst(self):
        for changes in [
            {'start': '2026-11-19T08:30:00', 'end': '2026-11-19T08:55:00'},
            {'timezone': 'Europe/Helsinki', 'timezone_source': 'setting'},
            {'start': '2026-10-25T03:30:00', 'end': '2026-10-25T03:55:00', 'timezone': 'Europe/Helsinki', 'timezone_source': 'setting'},
            {'start': '2026-03-29T03:30:00', 'end': '2026-03-29T03:55:00', 'timezone': 'Europe/Helsinki', 'timezone_source': 'setting'},
            {'start': '2026-11-19T10:30:00', 'end': '2026-11-19T10:55:00', 'timezone': 'Europe/Helsinki'},
        ]:
            self.assertEqual(slush.interval(self.meeting(**changes))['state'], 'unknown')

    def test_status_conflicts_and_unknown_status_fail_closed(self):
        self.source('meeting_observations', [self.meeting(), self.meeting(status='Sent requests'), self.meeting(meeting_id='m2', status='Probably accepted')])
        report = self.run_report()
        self.assertTrue(report['meetings'][1]['status_conflict'])
        self.assertTrue(all(not r['accepted_time_consistent'] for r in report['meetings']))

    def test_newest_snapshot_changes_state_but_preserves_history(self):
        self.source('meeting_observations', [self.meeting(status='Sent requests')], captured='2026-10-21T10:00:00Z')
        self.source('meeting_observations', [self.meeting()], captured='2026-10-21T12:00:00+02:00')
        self.assertEqual(self.run_report()['meetings'][0]['status'], 'unknown')
        self.sources[1]['captured_at'] = '2026-10-21T12:00:00.1+02:00'
        report = self.run_report()
        self.assertEqual(report['meetings'][0]['status'], 'accepted')
        self.assertEqual(len(report['meetings'][0]['observations']), 2)

    def test_conflicts_only_same_account_accepted_intervals(self):
        self.source('meeting_observations', [self.meeting(), self.meeting(meeting_id='m2', start='2026-11-19T08:50:00Z', end='2026-11-19T09:15:00Z'), self.meeting(meeting_id='m3', status='Sent requests')])
        self.source('meeting_observations', [self.meeting()], account='other')
        report = self.run_report()
        self.assertEqual(len(report['conflicts']), 1)
        self.assertEqual(report['summary']['conflict_free'], 'not_established')

    def test_adjacent_meetings_are_not_overlaps(self):
        self.source('meeting_observations', [self.meeting(), self.meeting(meeting_id='m2', start='2026-11-19T08:55:00Z', end='2026-11-19T09:20:00Z')])
        self.assertEqual(self.run_report()['conflicts'], [])

    def test_meeting_identity_and_source_required(self):
        self.source('meeting_observations', [self.meeting(meeting_id=''), self.meeting(source_ref='')])
        report = self.run_report()
        self.assertEqual(len(report['rejected']), 2)
        self.assertEqual(report['meetings'], [])

    def test_malformed_shapes_unsupported_schema_and_duplicate_json(self):
        path = self.source('sent_requests', [])
        path.write_text('name\tcompany\nA\tB\n')
        with self.assertRaises(ValueError):
            self.run_report()
        with self.assertRaises(ValueError):
            slush.strict_json('{"x":1,"x":2}')
        with self.assertRaises(ValueError):
            slush.strict_json('{"x":NaN}')
        self.sources[0]['kind'] = 'slush_api'
        with self.assertRaises(ValueError):
            self.run_report()

    def test_bounds_and_symlinks(self):
        path = self.source('meeting_observations', [])
        link = self.root / 'link'
        link.symlink_to(path)
        with self.assertRaises(ValueError):
            slush.read_file(link)
        with self.assertRaises(ValueError):
            slush.text('a' * (slush.MAX_TEXT + 1), 'x')
        self.sources *= 33
        with self.assertRaises(ValueError):
            self.run_report()

    def test_cli_private_output_no_overwrite_and_summary_only(self):
        self.source('meeting_observations', [self.meeting()])
        manifest = self.root / 'manifest.json'
        manifest.write_text(json.dumps({'version': 1, 'sources': self.sources}))
        command = [sys.executable, str(Path(__file__).with_name('offline.py')), '--manifest', str(manifest), '--output', str(self.root / 'report')]
        first = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertNotIn('meeting-1', first.stdout)
        output = self.root / 'report' / 'report.json'
        self.assertEqual(os.stat(output).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(output.parent).st_mode & 0o777, 0o700)
        original = output.read_bytes()
        self.assertEqual(subprocess.run(command, capture_output=True).returncode, 2)
        self.assertEqual(output.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
