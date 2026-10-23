# Offline Slush evidence reconciliation

This Python utility removes repeated row reading, deduplication, filtering and time arithmetic from agents. It consumes saved evidence; it does not collect current Slush data, send meeting requests or write calendars. Python 3.9+ and its standard library are sufficient. Named timezone conversion requires an available IANA timezone database; an unavailable zone produces an unknown time.

```sh
python3 deploy/slush/offline.py --manifest /private/slush/manifest.json --output /private/slush/review-001
python3 -m unittest discover -s deploy/slush -p 'test_*.py' -v
```

The output directory must not exist and its parent must exist. Output is a mode-0600 `report.json` inside a mode-0700 directory. Standard output contains counts and the output path, not names, addresses or meeting details. Store reports outside publicly served artifact directories. The utility has no network, credentials, model, browser or MCP dependency.

## Inputs supported by actual saved evidence

`manifest.example.json` is the local interface, not a provider API schema. Replace its placeholder paths/account/timestamps with evidence-backed values. `captured_at` means when that source was captured, not when this utility ran. Reprocessing an old file does not make it current. All sources require an explicit event and account reference; references must be consistent across observations of the same account/event.

Each TSV kind requires its exact header, in this order:

| Kind | Headers |
| --- | --- |
| `company_matches` | `account`, `slush_company`, `match`, `company_type`, `country`, `name`, `title` |
| `contacts` | `person`, `fund`, `fund_website`, `linkedin_url`, `email`, `email_status`, `source_url`, `source_date_or_retrieved_date`, `note` |
| `sent_requests` | `person`, `role_company`, `type`, `slots_offered` |

These are saved agent-produced extracts, not an independently verified Slush response. The company file's `match=exact` is preserved as an agent classification, not accepted as verified identity. A sent-request row is a `sent_claim`, never an accepted meeting. Its free-form offered slots remain unresolved: the observed strings lack a year, timezone and reliable AM/PM information, and an offered slot does not identify an accepted slot.

Exact duplicate rows within the same kind/event/account collapse with every source reference preserved. Names and domains are not used to merge identities. Different details remain separate records, including contradictory contact details. These TSVs contain no stable provider IDs, so no unique company/person count is claimed. `country` and `company_type` filters compare normalized strings; `company_contains` performs a normalized substring search. Filtering is mechanical and does not infer prospect suitability. The report retains all source records and separately lists matching record IDs.

Every source records its SHA-256, capture time, context and row count. Record provenance identifies source and row. Bounds: 32 sources, 16 MiB per file, 20,000 combined rows, 4,096 characters per cell. Unsupported schemas, malformed fields, duplicate JSON keys, symlink input files and oversized inputs fail validation. Output never overwrites an earlier report. Validation failure exits 2; rejected individual meeting observations remain explicitly listed in an otherwise successful report.

## Meeting observations: local contract, not a Slush export adapter

No retained raw meeting export schema was found. This optional JSON array is an explicit local handoff format for evidence extracted by a discovery agent or a future qualified collector. Each observation must cite its source and stable meeting ID. Do not invent IDs from person names or infer acceptance from a sent request.

```json
[
  {
    "meeting_id": "stable-provider-meeting-id",
    "status": "Accepted meetings",
    "start": "2026-11-19T10:30:00+02:00",
    "end": "2026-11-19T10:55:00+02:00",
    "source_ref": "saved accepted-meeting detail reference"
  }
]
```

Register this file as source kind `meeting_observations`. Recognized status labels are accepted/accepted meetings, sent/sent requests, received/received requests, declined and cancelled, case-insensitive. Other labels stay unknown. Missing IDs or source references are rejected instead of merged by name.

ISO start/end values require full dates and 24-hour time. UTC offsets establish instants. Alternatively provide `timezone` (IANA name) and `timezone_source` (the source establishing that zone) with local ISO times. Zone/source assertions are preserved; the utility cannot authenticate them. When both zone and offset are supplied they must agree. Missing zones, nonexistent DST times, ambiguous DST times, invalid dates and nonpositive intervals remain unknown. The utility never assumes Helsinki because the event is Slush, never adds two hours to resolve contradictory screens, and never infers a 25-minute duration when the end is missing.

Observations group only by event/account/meeting ID. The most recent supplied capture timestamp determines the current snapshot. Equal-instant captures are reconciled together; contradictory statuses or times yield unknown. Earlier snapshots remain in `observations`, allowing legitimate sent→accepted→cancelled changes without treating all history as current. Capture timestamps and evidence must accurately describe the source; this is not a source-authentication mechanism.

`accepted_time_consistent` means only that the latest supplied status says accepted and its time evidence is internally consistent. It is **not** current provider verification or calendar-write authority. Accepted intervals for the same account are compared across events, with adjacent intervals allowed. Conflict output stops at 1,000 pairs and reports truncation. Pending request slots do not create confirmed conflicts. `conflict_free` remains `not_established`: these inputs do not establish complete account availability or current provider state.

## Evidence and verification

Read-only copies inspected on 23 October 2026:

- `company/slush-newleader-matches.tsv`: 5 rows, observed seven-column schema.
- `company/slush-tier1-contacts-2026-10-21.tsv`: 11 rows, observed nine-column schema.
- `company/slush-sent-requests-2026-10-21.tsv`: 51 rows, observed four-column schema.
- Enabled `slush-meeting-tool` skill: describes company-level directory export, named meeting filters, company/person UUID routes and a two-hour discrepancy between Manage meetings and My Agenda. These are historical skill observations, not current endpoint validation.

The utility processed all 67 rows with zero rejections; all 51 sent requests stayed unconfirmed with unresolved offered times. That parser qualification uses a synthetic capture timestamp because the TSVs do not establish exact capture instants; no meeting-state comparison depends on it. Private source copies and output stay in `.omb-scratch/slush-evidence/`, excluded from Git. Synthetic tests exercise the CLI, duplicate evidence, invalid inputs, status transitions/conflicts, exact offset conversion, DST exceptions, two-hour contradictions, interval conflicts and output permissions/non-overwrite.

No app/server changes were made, so no live application fixture is claimed. Tests use temporary local files, not production account mutations.

## Remaining work

The full 4,952-company export mentioned in the skill was not present among inspected workspace/task-workspace/tmp files. No raw company JSON, private search endpoint or pagination contract is implemented. Capture a redacted genuine export/request schema before adding that adapter. Directory completeness and current attendance remain unknown; this small saved matches file cannot establish either.

A qualified collector should provide stable meeting IDs, accepted-slot evidence, exact zones and capture times to the local observation contract. The optional observation contract has synthetic test coverage, not current Slush qualification. Deployment and bot skill adoption remain with the integration owner. The tool alone does not authorize business actions or prove that a meeting occurred.
