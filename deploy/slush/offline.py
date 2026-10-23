#!/usr/bin/env python3
import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sys
import unicodedata
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

MAX_BYTES = 16 * 1024 * 1024
MAX_ROWS = 20000
MAX_SOURCES = 32
MAX_TEXT = 4096
HEADERS = {
    'company_matches': ['account', 'slush_company', 'match', 'company_type', 'country', 'name', 'title'],
    'contacts': ['person', 'fund', 'fund_website', 'linkedin_url', 'email', 'email_status', 'source_url', 'source_date_or_retrieved_date', 'note'],
    'sent_requests': ['person', 'role_company', 'type', 'slots_offered'],
}
STATUSES = {'accepted': 'accepted', 'accepted meetings': 'accepted',
            'sent': 'sent', 'sent requests': 'sent', 'received': 'received',
            'received requests': 'received', 'declined': 'declined', 'cancelled': 'cancelled'}


def text(value, field, required=False):
    if not isinstance(value, str) or len(value) > MAX_TEXT or '\x00' in value:
        raise ValueError(f'invalid {field}')
    if required and not value.strip():
        raise ValueError(f'missing {field}')
    return value.strip()


def key(value):
    return ' '.join(unicodedata.normalize('NFKC', value).casefold().split())


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def read_file(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_BYTES:
        raise ValueError('input must be a regular non-symlink file within size limit')
    with path.open('rb') as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('input size limit exceeded')
    return data


def strict_json(data):
    def pairs(items):
        result = {}
        for k, value in items:
            if k in result:
                raise ValueError('duplicate JSON key')
            result[k] = value
        return result
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite JSON number')))


def aware_timestamp(value):
    value = text(value, 'timestamp', True)
    if not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,6})?)?(?:Z|[+-]\d\d:\d\d)', value):
        raise ValueError('timestamp requires date, time and explicit UTC offset')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return parsed.astimezone(timezone.utc)


def utc_string(value):
    return value.isoformat(timespec='microseconds').replace('+00:00', 'Z')


def instant(value, zone_name='', zone_source=''):
    value = text(value, 'time', True)
    if not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,6})?)?(?:Z|[+-]\d\d:\d\d)?', value):
        raise ValueError('time requires complete ISO date and 24-hour time')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    zone = None
    if zone_name:
        if not zone_source:
            raise ValueError('named timezone requires source evidence')
        try:
            zone = ZoneInfo(zone_name)
        except (ValueError, ZoneInfoNotFoundError):
            raise ValueError('unknown timezone') from None
    if parsed.tzinfo is not None:
        if zone and parsed.astimezone(zone).utcoffset() != parsed.utcoffset():
            raise ValueError('offset disagrees with named timezone')
        return parsed.astimezone(timezone.utc)
    if zone is None:
        raise ValueError('timezone is unknown')
    candidates = set()
    for fold in [0, 1]:
        local = parsed.replace(tzinfo=zone, fold=fold)
        utc = local.astimezone(timezone.utc)
        if utc.astimezone(zone).replace(tzinfo=None) == parsed:
            candidates.add(utc)
    if len(candidates) != 1:
        raise ValueError('local time is ambiguous or nonexistent')
    return candidates.pop()


def interval(row):
    try:
        start = instant(row.get('start', ''), row.get('timezone', ''), row.get('timezone_source', ''))
        end = instant(row.get('end', ''), row.get('timezone', ''), row.get('timezone_source', ''))
        if end <= start:
            raise ValueError('end must follow start')
        return {'state': 'resolved', 'start_utc': utc_string(start), 'end_utc': utc_string(end)}
    except ValueError as error:
        return {'state': 'unknown', 'reason': str(error)}


def source_rows(source, base):
    path = Path(text(source.get('path'), 'source path', True))
    path = path if path.is_absolute() else base / path
    raw = read_file(path)
    kind = source.get('kind')
    if kind in HEADERS:
        reader = csv.DictReader(io.StringIO(raw.decode('utf-8-sig')), delimiter='\t')
        if reader.fieldnames != HEADERS[kind]:
            raise ValueError(f'{kind} requires exact observed TSV headers')
        rows = list(reader)
    elif kind == 'meeting_observations':
        rows = strict_json(raw)
        if not isinstance(rows, list):
            raise ValueError('meeting observations must be a JSON array')
    else:
        raise ValueError('unsupported source kind')
    if len(rows) > MAX_ROWS:
        raise ValueError('row limit exceeded')
    for row in rows:
        if not isinstance(row, dict) or any(not isinstance(k, str) for k in row):
            raise ValueError('invalid row shape')
        for k, value in row.items():
            text(value, k)
    return rows, hashlib.sha256(raw).hexdigest()


def reconcile_meetings(observations):
    grouped = {}
    for row in observations:
        identity = (row['event'], row['account'], row['meeting_id'])
        grouped.setdefault(identity, []).append(row)
    result = []
    for identity, rows in sorted(grouped.items()):
        latest = max(row['captured_at'] for row in rows)
        current = [row for row in rows if row['captured_at'] == latest]
        statuses = {row['status'] for row in current}
        status = next(iter(statuses)) if len(statuses) == 1 else 'unknown'
        times = {json.dumps(row['interval'], sort_keys=True) for row in current}
        resolved = len(times) == 1 and current[0]['interval']['state'] == 'resolved'
        timing = current[0]['interval'] if resolved else {'state': 'unknown', 'reason': 'missing or contradictory current time evidence'}
        result.append({'event': identity[0], 'account': identity[1], 'meeting_id': identity[2],
                       'status': status, 'status_conflict': len(statuses) > 1,
                       'interval': timing, 'captured_at': latest,
                       'current_evidence': [row['provenance'] for row in current],
                       'observations': rows,
                       'accepted_time_consistent': status == 'accepted' and timing['state'] == 'resolved'})
    return result


def conflicts(meetings):
    accepted = sorted((row for row in meetings if row['accepted_time_consistent']),
                      key=lambda row: (row['account'], row['interval']['start_utc']))
    found = []
    for i, left in enumerate(accepted):
        for right in accepted[i + 1:]:
            if left['account'] != right['account'] or right['interval']['start_utc'] >= left['interval']['end_utc']:
                break
            a, b = left['interval'], right['interval']
            if max(a['start_utc'], b['start_utc']) < min(a['end_utc'], b['end_utc']):
                if len(found) == 1000:
                    return found, True
                found.append({'account': left['account'], 'meetings': [
                    {'event': left['event'], 'meeting_id': left['meeting_id']},
                    {'event': right['event'], 'meeting_id': right['meeting_id']}],
                    'kind': 'accepted_interval_overlap'})
    return found, False


def run(manifest, base):
    if not isinstance(manifest, dict) or manifest.get('version') != 1:
        raise ValueError('manifest version must be 1')
    sources = manifest.get('sources')
    if not isinstance(sources, list) or not 1 <= len(sources) <= MAX_SOURCES:
        raise ValueError('manifest requires 1 to 32 sources')
    filters = manifest.get('filters', {})
    if not isinstance(filters, dict) or set(filters) - {'country', 'company_type', 'company_contains'}:
        raise ValueError('unsupported filters')
    for field, value in filters.items():
        text(value, field, True)
    source_ids = set()
    records, meeting_rows, evidence, rejected = {}, [], [], []
    input_count = 0
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError('invalid source')
        sid = text(source.get('id'), 'source id', True)
        if sid in source_ids:
            raise ValueError('duplicate source id')
        source_ids.add(sid)
        event = text(source.get('event'), 'event', True)
        account = text(source.get('account'), 'account', True)
        captured = utc_string(aware_timestamp(source.get('captured_at')))
        rows, sha = source_rows(source, base)
        input_count += len(rows)
        if input_count > MAX_ROWS:
            raise ValueError('combined row limit exceeded')
        kind = source['kind']
        evidence.append({'id': sid, 'kind': kind, 'sha256': sha, 'row_count': len(rows),
                         'event': event, 'account': account, 'captured_at': captured})
        for n, raw in enumerate(rows, 1):
            prov = {'source_id': sid, 'sha256': sha, 'row': n}
            if kind == 'meeting_observations':
                allowed = {'meeting_id', 'status', 'start', 'end', 'timezone', 'timezone_source', 'source_ref'}
                try:
                    if set(raw) - allowed:
                        raise ValueError('unknown observation fields')
                    mid = text(raw.get('meeting_id'), 'meeting_id', True)
                    source_ref = text(raw.get('source_ref'), 'source_ref', True)
                    status = STATUSES.get(key(raw.get('status', '')), 'unknown')
                    meeting_rows.append({'event': event, 'account': account, 'meeting_id': mid,
                                         'status': status, 'raw': raw, 'interval': interval(raw),
                                         'source_ref': source_ref, 'captured_at': captured, 'provenance': prov})
                except ValueError as error:
                    rejected.append({'provenance': prov, 'reason': str(error)})
                continue
            required = {'company_matches': 'slush_company', 'contacts': 'person', 'sent_requests': 'person'}[kind]
            if not raw[required].strip():
                rejected.append({'provenance': prov, 'reason': f'missing {required}'})
                continue
            identity = digest({'kind': kind, 'event': event, 'account': account, 'raw': raw})
            if identity in records:
                records[identity]['provenance'].append(prov)
                continue
            row = {'record_id': identity, 'kind': kind, 'event': event, 'account': account,
                   'raw': raw, 'provenance': [prov], 'identity_state': 'no_provider_id'}
            if kind == 'sent_requests':
                row.update(status='sent_claim', status_evidence='saved_agent_report',
                           interval={'state': 'unknown', 'reason': 'offered slots lack full date/timezone/24-hour time and are not an accepted slot'},
                           accepted_time_consistent=False)
            elif kind == 'company_matches':
                row['match_evidence'] = 'saved_agent_classification_not_verified_identity'
            records[identity] = row
    company_rows = [r for r in records.values() if r['kind'] == 'company_matches']
    filtered = []
    for row in company_rows:
        raw = row['raw']
        if any(key(raw[k]) != key(filters[k]) for k in ['country', 'company_type'] if k in filters):
            continue
        if 'company_contains' in filters and key(filters['company_contains']) not in key(raw['slush_company']):
            continue
        filtered.append(row['record_id'])
    meetings = reconcile_meetings(meeting_rows)
    overlaps, truncated = conflicts(meetings)
    unresolved = sum(not r['accepted_time_consistent'] for r in meetings if r['status'] not in {'sent', 'received', 'declined', 'cancelled'})
    return {'version': 1, 'sources': evidence, 'records': list(records.values()),
            'filtered_company_record_ids': filtered, 'meetings': meetings, 'conflicts': overlaps,
            'rejected': rejected, 'summary': {'input_rows': input_count, 'unique_saved_rows': len(records),
                'exact_duplicate_rows': input_count - len(meeting_rows) - len(rejected) - len(records),
                'meeting_observations': len(meeting_rows), 'meetings': len(meetings),
                'accepted_time_consistent': sum(r['accepted_time_consistent'] for r in meetings),
                'unresolved_meetings': unresolved, 'conflicts_truncated': truncated,
                'directory_completeness': 'unknown', 'current_provider_state': 'not_checked',
                'calendar_mutation_authority': 'not_assessed', 'conflict_free': 'not_established'}}


def main():
    parser = argparse.ArgumentParser(description='Offline Slush evidence normalization; never calls Slush or a calendar.')
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        report = run(strict_json(read_file(args.manifest)), args.manifest.parent)
        args.output.mkdir(mode=0o700, parents=False, exist_ok=False)
        target = args.output / 'report.json'
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        print(json.dumps({'output': str(target), 'summary': report['summary'], 'rejected_rows': len(report['rejected'])}))
        return 0
    except (ValueError, OSError, UnicodeError, csv.Error, RecursionError) as error:
        print(json.dumps({'error': type(error).__name__, 'message': 'Offline input/output validation failed; inspect the manifest, file permissions and documented schema.'}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
