#!/usr/bin/env python3
import argparse
import csv
import hashlib
import io
import ipaddress
import json
import os
from pathlib import Path
import re
import sys
import unicodedata
from urllib.parse import urlsplit

MAX_FILE = 20 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024
MAX_ROWS = 100000
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')


def text(value):
    if not isinstance(value, str) or len(value) > 4096 or any(ord(c) < 32 and c not in '\t\n\r' for c in value):
        raise ValueError('Invalid or oversized text field')
    return ' '.join(unicodedata.normalize('NFC', value).split())


def key(value):
    return text(value).casefold()


def domain(value):
    value = text(value)
    if not value:
        return ''
    parsed = urlsplit(value if '://' in value else 'https://' + value)
    if parsed.scheme not in ('https', 'http') or parsed.username or parsed.password or parsed.port or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('Domain must be a hostname or HTTP(S) origin')
    host = (parsed.hostname or '').rstrip('.').encode('idna').decode('ascii').lower()
    if host.startswith('www.'):
        host = host[4:]
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError('IP address is not a company domain')
    if '.' not in host or len(host) > 253 or not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in host.split('.')):
        raise ValueError('Invalid company domain')
    return host


def profile(value, event):
    parsed = urlsplit(text(value))
    prefix = '/' + event + '/profiles/'
    identifier = parsed.path.removeprefix(prefix).lower()
    if parsed.scheme != 'https' or parsed.netloc != 'attend.websummit.com' or not parsed.path.startswith(prefix) or not UUID.fullmatch(identifier) or parsed.query or parsed.fragment:
        raise ValueError('Invalid event profile URL')
    return identifier


def load_file(root, relative):
    root = Path(root).resolve(strict=True)
    if not isinstance(relative, str) or Path(relative).is_absolute() or '..' in Path(relative).parts:
        raise ValueError('Source must be a relative path inside the manifest directory')
    path = root / relative
    for candidate in [path, *path.parents]:
        if candidate == root:
            break
        if candidate.is_symlink():
            raise ValueError('Source symlinks are not supported')
    if not path.is_file() or not path.resolve().is_relative_to(root):
        raise ValueError('Source is not an allowed regular file')
    with path.open('rb') as stream:
        data = stream.read(MAX_FILE + 1)
    if len(data) > MAX_FILE:
        raise ValueError('Source exceeds 20 MiB')
    return data


def parse_rows(data, format_name, kind=None):
    decoded = data.decode('utf-8-sig')
    if format_name == 'json':
        rows = json.loads(decoded)
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise ValueError('JSON source must be an array of normalized records')
        return rows
    if format_name not in ('csv', 'tsv'):
        raise ValueError('Supported formats are csv, tsv and normalized json; HTML needs verified selectors')
    reader = csv.DictReader(io.StringIO(decoded, newline=''), delimiter=',' if format_name == 'csv' else '\t', strict=True)
    fields = reader.fieldnames
    if not fields or len(fields) != len(set(fields)) or any(not field for field in fields):
        raise ValueError('Missing or duplicate column headers')
    if kind == 'company' and not {'ws_company_id', 'name', 'category', 'country', 'industry', 'website_domain'}.issubset(fields):
        raise ValueError('Unrecognized company export headers')
    if kind == 'person' and (not {'profile_url', 'name'}.issubset(fields) or not {'company', 'account'}.intersection(fields)):
        raise ValueError('Unrecognized people export headers')
    rows = []
    for row in reader:
        if None in row or None in row.values():
            raise ValueError('Row width does not match header')
        rows.append(row)
        if len(rows) > MAX_ROWS:
            raise ValueError('Too many source rows')
    return rows


def normalize(row, kind, format_name, event):
    if format_name == 'json':
        required = {'id', 'name'} if kind == 'company' else {'profile_url', 'name'}
    else:
        required = {'ws_company_id', 'name', 'category', 'country', 'industry', 'website_domain'} if kind == 'company' else {'profile_url', 'name'}
    if not required.issubset(row):
        raise ValueError('Unrecognized source columns; headerless or unsupported exports cannot be inferred')
    if kind == 'company':
        identifier = text(row.get('id', '') if format_name == 'json' else row['ws_company_id'])
        if not re.fullmatch(r'[0-9]{1,20}', identifier):
            raise ValueError('Invalid company ID')
        company = ''
        company_domain = domain(row.get('domain', '') if format_name == 'json' else row['website_domain'])
    else:
        identifier = profile(row['profile_url'], event)
        if format_name != 'json' and not ('company' in row or 'account' in row):
            raise ValueError('People export requires explicit company or account column')
        company = text(row.get('company', row.get('account', '')))
        if row.get('company') and row.get('account') and key(row['company']) != key(row['account']):
            raise ValueError('Conflicting company and account columns')
        company_domain = domain(row.get('domain', '')) if format_name == 'json' else ''
    name = text(row['name'])
    if not name:
        raise ValueError('Record name is empty')
    return {'kind': kind, 'id': identifier, 'name': name, 'company': company, 'domain': company_domain,
            'country': text(row.get('country', '')), 'industry': text(row.get('industry', '')),
            'role': text(row.get('role', row.get('title', ''))),
            'profile_url': f'https://attend.websummit.com/{event}/profiles/{identifier}' if kind == 'person' else ''}


def build(manifest, root):
    event = manifest.get('event')
    if not isinstance(event, str) or not re.fullmatch(r'[a-z]{2,12}[0-9]{2}', event):
        raise ValueError('Explicit event code is required')
    sources = manifest.get('sources')
    if not isinstance(sources, list) or not 1 <= len(sources) <= 100:
        raise ValueError('Provide 1–100 source descriptors')
    records = {}
    evidence = []
    total_bytes = total_rows = 0
    rejected = []
    for source_index, source in enumerate(sources):
        if not isinstance(source, dict) or source.get('kind') not in ('person', 'company'):
            raise ValueError('Source kind must be person or company')
        data = load_file(root, source.get('path'))
        total_bytes += len(data)
        if total_bytes > MAX_TOTAL:
            raise ValueError('Total input exceeds 64 MiB')
        rows = parse_rows(data, source.get('format'), source['kind'])
        total_rows += len(rows)
        if total_rows > MAX_ROWS:
            raise ValueError('Total input exceeds 100000 rows')
        digest = hashlib.sha256(data).hexdigest()
        source_id = f'source-{source_index + 1}'
        evidence.append({'id': source_id, 'path': source['path'], 'sha256': digest, 'kind': source['kind'], 'rows': len(rows), 'captured_at': source.get('captured_at'), 'captured_at_verified': False})
        for row_index, row in enumerate(rows):
            try:
                normalized = normalize(row, source['kind'], source['format'], event)
            except (ValueError, TypeError, KeyError) as error:
                rejected.append({'source': source_id, 'row': row_index + 1, 'reason': str(error)})
                continue
            identity = f"{normalized['kind']}:{normalized['id']}"
            reference = {'source': source_id, 'row': row_index + 1}
            entry = records.setdefault(identity, {'key': identity, 'variants': [], 'evidence': []})
            if normalized not in entry['variants']:
                entry['variants'].append(normalized)
            entry['evidence'].append(reference)
    result = []
    for identity in sorted(records):
        entry = records[identity]
        entry['variants'].sort(key=lambda item: json.dumps(item, sort_keys=True))
        entry['conflicting_fields'] = [field for field in entry['variants'][0] if len({key(variant[field]) for variant in entry['variants'] if variant[field]}) > 1]
        result.append(entry)
    coverage = []
    totals = manifest.get('reported_totals', {})
    if not isinstance(totals, dict) or any(kind not in ('person', 'company') or type(value) is not int or value < 0 for kind, value in totals.items()):
        raise ValueError('Reported totals must be nonnegative integer person/company counts')
    for kind in ('person', 'company'):
        entries = [entry for entry in result if entry['variants'][0]['kind'] == kind]
        count = len(entries)
        reported = totals.get(kind)
        coverage.append({'kind': kind, 'unique_ids': count, 'conflicting_ids': sum(bool(entry['conflicting_fields']) for entry in entries),
                         'reported_total': reported, 'reported_total_verified': False,
                         'difference_from_reported_total': reported - count if reported is not None else None,
                         'provider_completeness': 'unverified',
                         'scope': 'exhibitors; not all attendee employers' if kind == 'company' else 'observed people only; randomized sweeps cannot establish absence'})
    report = {'event': event, 'sources': evidence, 'input_rows': total_rows, 'accepted_rows': total_rows - len(rejected),
              'unique_records': len(result), 'duplicate_rows': total_rows - len(rejected) - len(result),
              'rejected_rows': rejected, 'coverage': coverage, 'network_calls': 0}
    return {'schema_version': 1, 'event': event, 'records': result}, report


def match(directory, prospects):
    if not isinstance(prospects, list) or len(prospects) > 1000:
        raise ValueError('Prospects must be an array of at most 1000 queries')
    outcomes = []
    seen = set()
    entries = {entry['key']: entry for entry in directory['records']}
    index = {}
    def value(row, field):
        if field == 'company' and row['kind'] == 'company':
            return key(row['name'])
        return key(row[field])
    for entry in entries.values():
        for row in entry['variants']:
            for field in ('id', 'name', 'company', 'domain'):
                normalized = value(row, field)
                if normalized:
                    index.setdefault((row['kind'], field, normalized), set()).add(entry['key'])
    for prospect in prospects:
        if not isinstance(prospect, dict) or prospect.get('kind') not in ('person', 'company'):
            raise ValueError('Prospect kind must be person or company')
        query_id = text(prospect.get('id', ''))
        if not query_id or query_id in seen:
            raise ValueError('Prospect IDs must be unique and nonempty')
        seen.add(query_id)
        criteria = {}
        if prospect.get('profile_url'):
            if prospect['kind'] != 'person':
                raise ValueError('Profile URL only applies to person queries')
            criteria['id'] = profile(prospect['profile_url'], directory['event'])
        for field in ('name', 'company', 'domain'):
            if prospect.get(field):
                criteria[field] = domain(prospect[field]) if field == 'domain' else key(prospect[field])
        if not criteria:
            raise ValueError('Prospect needs explicit identity criteria')
        sets = [index.get((prospect['kind'], field, wanted), set()) for field, wanted in criteria.items()]
        possible = set.intersection(*sets)
        candidates = [entries[identity] for identity in sorted(possible)
                      if any(all(value(row, field) == wanted for field, wanted in criteria.items())
                             for row in entries[identity]['variants'])]
        candidate_keys = {entry['key'] for entry in candidates}
        related = sorted(set.union(*sets) - candidate_keys)
        if len(candidates) == 1 and not candidates[0]['conflicting_fields']:
            status = 'exact_match' if prospect['kind'] == 'company' or 'id' in criteria else 'exact_candidate'
        else:
            status = 'uncertain'
        reason = 'exact criteria on one unconflicted record' if status != 'uncertain' else ('ambiguous_or_conflicting_records' if candidates else 'no_exact_observation; absence_not_established')
        outcomes.append({'id': query_id, 'status': status, 'reason': reason, 'criteria': criteria,
                         'candidate_count': len(candidates),
                         'candidates': [{'key': entry['key'], 'conflicting_fields': entry['conflicting_fields'], 'evidence': entry['evidence'][:20], 'evidence_count': len(entry['evidence'])} for entry in candidates[:100]],
                         'partial_match_count': len(related), 'partial_match_keys': related[:100],
                         'results_truncated': len(candidates) > 100 or len(related) > 100 or any(len(entry['evidence']) > 20 for entry in candidates[:100]),
                         'attendance_verified': False})
    return outcomes


def run(manifest_path, output_path):
    manifest_path = Path(manifest_path).resolve(strict=True)
    root = manifest_path.parent
    manifest = json.loads(load_file(root, manifest_path.name))
    if not isinstance(manifest, dict):
        raise ValueError('Manifest must be an object')
    directory, report = build(manifest, root)
    matches = match(directory, manifest.get('prospects', []))
    output = Path(output_path)
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    for name, value in [('directory.json', directory), ('matches.json', matches), ('report.json', report)]:
        with os.fdopen(os.open(output / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
    return {'output': str(output.resolve()), 'unique_records': report['unique_records'], 'rejected_rows': len(report['rejected_rows']), 'queries': len(matches), 'provider_completeness': 'unverified'}


def main():
    parser = argparse.ArgumentParser(description='Normalize saved Web Summit exports and match exact prospect criteria offline.')
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        result = run(args.manifest, args.output)
    except (ValueError, OSError, TypeError, KeyError, csv.Error):
        print(json.dumps({'error': 'invalid_input_or_output', 'detail': 'Check manifest, source formats, file bounds and fresh output directory; no network request was made.'}), file=sys.stderr)
        return 2
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    sys.exit(main())
