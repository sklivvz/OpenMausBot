# Web Summit saved-directory automation

This offline utility replaces repeated model work reading exports, deduplicating
sweeps, matching explicit prospect criteria and counting coverage. It performs
no browser operation or network request. It does not send connection/meeting
requests or write to calendars. Python 3.9+ and its standard library are enough;
there is no model, credential, MCP server, package install or build step.

## Use

Put a manifest beside the saved source files. Adapt `manifest.example.json` to
those files and the actual event. Then run:

```sh
python3 deploy/websummit/directory.py \
  --manifest /workspace/saved-directory/manifest.json \
  --output /workspace/saved-directory/result-001
```

The output directory must not exist; its parent must exist. The utility creates
it with mode 0700 and writes three mode-0600 files:

- `directory.json`: stable IDs, normalized variants and source-row references.
- `matches.json`: bounded exact matches or uncertain results for the prospects.
- `report.json`: source hashes, row acceptance/rejection, duplicate counts,
  conflicting records and coverage. Written last; absent report means an
  incomplete output, which must not be consumed.

Stdout contains only counts and the output location. Source data stays in local
files. Exit code 2 means invalid input/output; the error deliberately omits
source data. A partial output after an IO failure remains for inspection; rerun
with a fresh destination. The tool never overwrites an earlier run. This is a
CLI/library slice; no runtime bot skill or MCP configuration has been changed.

## Input contract

`event` is explicit, e.g. `lis26`. `sources` contains 1–100 descriptors with
`kind` (`company` or `person`), `format` (`csv`, `tsv`, `json`) and `path` relative
to the manifest directory. Optional `captured_at` is retained as a source claim,
not independently verified freshness. Relative traversal and symlinks inside
the source tree are refused. Input limits: 20 MiB/file, 64 MiB total and 100,000
rows. Files must be stable during a run; path checks are not a sandbox against
another process changing the filesystem concurrently.

Supported saved export shapes were observed on 2026-10-23:

| Kind | Required columns | Additional fields used |
| --- | --- | --- |
| Exhibitor CSV | `ws_company_id,name,category,country,industry,website_domain` | None |
| People TSV | `profile_url,name`, plus `company` or `account` | `country,industry,role` or `title` |
| Normalized JSON array, companies | `id,name` | `domain,country,industry,role` |
| Normalized JSON array, people | `profile_url,name` | `company,domain,country,industry,role` |

Company IDs are numeric strings from the observed export. People use the UUID
in an exact HTTPS `attend.websummit.com/<event>/profiles/<uuid>` URL. A malformed
record is retained as a source/row rejection in the report; it is never silently
counted as accepted. Duplicate headers, malformed CSV width, unsupported formats
and file errors reject the run. Headerless exports are unsupported. JSON is our
explicit normalized interchange format, not a claim about the provider API.

Records merge only on stable ID and kind. Distinct field values remain as
variants; conflicting nonempty fields are reported. Source order does not
choose a winner. Case and Unicode/whitespace normalization do not remove legal
suffixes, punctuation or accents. Domains normalize case, IDNA and an initial
`www.` only; sibling subdomains and different registrable domains remain
separate. No website is fetched and no alias is inferred.

`prospects` contains up to 1,000 queries, each with unique nonempty `id`, `kind`
and one or more of `name`, `company`, `domain`, `profile_url`. All supplied
criteria must match the same observed variant. Company queries can use `company`
as their exact name. A unique unconflicted company result or exact profile UUID
is `exact_match`. A person matched by name/employer is only `exact_candidate`:
two humans may share those details. Multiple candidates, conflicting variants
and misses return `uncertain`. Partial matches are reported for review, not
promoted to matches. Results include exact candidate/partial-match counts but
cap returned lists at 100 and each evidence list at 20; `results_truncated`
flags omitted details, available in `directory.json`.

## Coverage and authority

A source file proves what was saved, not who currently attends. Every result
keeps `attendance_verified: false`. The skill's historical observations describe
randomized people pages and a stable exhibitor list. Repeated randomized sweeps
cannot establish absence or complete coverage; exhibitors are not all attendee
employers. This utility never emits `complete` for the provider directory.

Optional `reported_totals` maps `person`/`company` to nonnegative integer counts.
The report labels those totals unverified and shows the signed difference,
including negative differences that reveal stale or differently scoped totals.
Matching a total alone is insufficient evidence of completeness.

No Jev classifier is needed for these exact mechanical operations. Unknown
aliases, company relevance and conflicting observations remain with the
reasoning layer. A later classifier must consume those explicit unknowns;
it cannot turn a guess into a verified identity or authorize outreach.

## Evidence and remaining discovery

The read-only live skill snapshot was
`web-summit-attendee-platform` for Blake; it records a 2026-10-17 platform walk.
On 2026-10-23 we inspected saved files under the shared company workspace:

- `websummit-exhibitors.csv`: 2,471 rows with unique numeric company IDs.
- `websummit-icp-prospects.tsv`: 317 rows with profile UUID URLs.
- `websummit-priority-accounts.tsv` and `websummit-newleader-matches.tsv`:
  headered people variants using `account`.
- `websummit-priority-markets-additions.tsv`: headerless; not ingested.

Read-only local copies of the first two files produced 2,788 normalized records
with zero rejections and zero conflicting IDs. Passing the skill's historical
2,458 company count yields a difference of -13 and unverified completeness.
Private copies and full reports remain in `.omb-scratch/websummit-qualification`
in the task worktree, excluded from Git; no personal records are committed.

No retained raw HTML/Turbo-stream sample with a verified card schema was found
in the inspected artifacts. HTML parsing, live pagination, login, slot lookup
and meeting status reconciliation are not implemented. They need captured,
redacted fixtures before stable selectors or BFF contracts can be written.
In particular the skill ambiguously describes the Sent connection filter as
meeting requests; this utility does not repeat that assumption.

## Verification

```sh
python3 -m unittest discover -s deploy/websummit -p 'test_*.py'
```

Tests use synthetic exports and disposable output directories. They cover
cross-sweep deduplication, preserved conflicting observations, exact vs
ambiguous matching, criteria on a single variant, malformed exports, URL/event
pinning, source path and size limits, private output permissions, and a real
CLI run with overwrite refusal. This is offline artifact processing: there is
no app/server mutation or claim of a deployed bot workflow.
