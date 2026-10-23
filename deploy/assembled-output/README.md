# Assembled-output verification

This deterministic verifier checks a saved, assembled HTML artifact against an
explicit manifest. It performs no network requests, provider writes, content
changes, rendering or model calls. It complements Keila's exact API readback;
readback proves storage integrity, while this tool checks requested components.
It does not replace the designer's native workflow or an independent visual review.

## Use

Python 3.9 or newer is sufficient; no packages are required.

```sh
python3 deploy/assembled-output/verifier.py \
  --root /absolute/task-workspace \
  --artifact /absolute/task-workspace/assembled.html \
  --manifest /absolute/task-workspace/verification.json \
  > /absolute/task-workspace/verification-receipt.json
```

Use an actual saved/rendered artifact, not an unevaluated reusable template.
A representative recipient sample checks only that sample's personalization.
Do not manufacture a campaign or send a test email to obtain a sample without
existing task authority. Reuse an authorized provider preview/export or existing
artifact. Missing access is an explicit dependency.

The manifest pins exact file bytes and supplies requirements from the current
brief. The verifier validates requirements; it does not invent or approve them.

```json
{
  "artifact": {
    "id": "provider-campaign-id",
    "version": "review-v2",
    "sha256": "EXACT_SHA256_OF_ASSEMBLED_HTML_BYTES",
    "source_ref": "original-task-or-provider-reference"
  },
  "requirements": {
    "required_text": ["Exact approved issue paragraph."],
    "required_links": ["https://example.com/product"],
    "required_images": [
      {"src": "https://example.com/approved-image.png", "alt": "Approved illustration"}
    ],
    "forbidden_text": ["[INSERT ISSUE COPY]"],
    "personalization": [{"name": "named-recipient sample", "expected_text": "Hello Ada"}],
    "allowed_unresolved": ["{{ unsubscribe_link }}"]
  }
}
```

HTML entities in text and attribute values are decoded by Python's HTML parser.
Text checks normalize whitespace; they establish text-node presence, not exact
HTML preservation or visual visibility. Script, style and comment contents cannot
satisfy required prose. Required image alt text is optional, and an explicitly
empty decorative alt is valid. No generic style blacklist is invented.

Links allow absolute HTTP(S), mailto, tel and existing same-document anchors.
Images allow absolute HTTP(S) or cid references; attachment existence is not
established. Relative/local/empty references fail. Explicitly allowed late-bound
Liquid tokens leave affected URL checks unknown. Unlisted Liquid tokens fail;
other placeholder forms must be supplied explicitly in `forbidden_text`.

## Receipt contract

The result contains `schema_version`, `verifier_version`, the artifact's
`id`, `version`, actual `sha256`, `expected_sha256`, optional `source_ref`, a
`contract_sha256`, and per-check `pass`, `fail` or `unknown` evidence. Evidence
indexes refer to manifest arrays or parsed links/images and are capped at 20,
with a total and truncation flag.

Any failed check produces `status: failed`. Otherwise the status is
`needs_review`, because remote reachability, visual layout and real email-client
rendering remain unknown. Missing requirements are unknown, not successful
checks. A mismatched artifact hash fails and skips all content checks.
The receipt never represents copy/design approval, acceptance or permission to
publish. Regenerate it when the artifact or requirements change.

A review packet may carry this receipt when artifact ID, version and actual hash
match. It must show unresolved checks and failures rather than imply that
`needs_review` means the artifact is complete. A semantic or visual reviewer
receives the exact artifact and remaining checks, not an instruction to redo
mechanical checks that already passed.

## MCP installation

Register an absolute Python command and absolute script path:

```json
{
  "name": "assembled-output",
  "command": "/usr/bin/python3",
  "args": [
    "/opt/openmausbot/tools/assembled-output/verifier.py",
    "--root", "/data/.openmausbot/task-workspaces/EXECUTOR_ID",
    "--root", "/data/.openmausbot/workspaces/EXECUTOR_ID",
    "--mcp"
  ]
}
```

Resolve the actual installed Python path before deployment. Each configured root
must already exist. Expose `verify_assembled_output` to the production executor
and reviewer as needed. Arguments are `artifact_file` and `manifest_file`.
Files must resolve beneath an allowed root; symlink escapes are rejected. The
adapter returns errors without exposing artifact content or private filesystem
errors. It does not write receipts itself; retain the returned JSON using the
existing task artifact mechanism. No server rebuild is required for the utility,
but registration/selection and deployment are separate steps.

## Verification

```sh
python3 -m unittest discover -s deploy/assembled-output -p 'test_*.py' -v
```

Thirteen isolated tests cover exact version checks, changed requirements, missing
components, text hidden in script/style/comments, invalid URLs, decorative alt,
explicit late-bound tokens, unconfigured requirements, size/schema bounds,
symlink escape and real stdio MCP discovery/execution against temporary files.
They verify source files remain unchanged.

On 2026-10-23 an isolated OpenMaus fixture registered and probed the Python MCP,
returned exactly `verify_assembled_output`, enabled the server and saved its
selection on a disposable bot. GET `/api/bots` confirmed that selection. The
fixture used temporary app data; no live bot or content was changed. Server log:
`/var/folders/m8/7zpq1vyn0g138lf533b16n000000gn/T/openmausbot-verification-evidence/server-1792781503951-19920.log`.

These checks prove the mechanical interface and fixture behavior. No real email
or campaign was verified, no cost savings were measured, and production deployment
remains with the integration owner.
