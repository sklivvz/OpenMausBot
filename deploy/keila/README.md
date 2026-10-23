# Keila draft preparation

`keila-drafts-mcp` replaces repeated browser editing with deterministic API calls.
It does not expose send, schedule, transactional messages, test emails or deletion.
Its provider key is project-wide: the omitted operations are a tool boundary,
not a claim that Keila issues read/draft-only keys.

The API contract was checked against the live cloud
[OpenAPI document](https://app.keila.io/api/v1/openapi) on 2026-10-23.
[API authentication](https://www.keila.io/docs/api/authentication/) uses a project
API key, issued once and revocable in that project's API Keys page.

## Installation

Build with `node deploy/keila/build.mjs`; both local Dockerfiles include the result.
Configure an MCP server with absolute command `/usr/local/bin/keila-drafts-mcp`
and `KEILA_CONFIG_FILE=/data/.openmausbot/providers/keila/config.json`.
Keep its key and configuration outside bot workspaces, under `providers/keila`
(which the existing workspace backup policy excludes), with directory mode 0700
and file mode 0600. Never put the key in MCP arguments, tool results or skills.

Configuration:

```json
{
  "baseUrl": "https://app.keila.io",
  "projectId": "np_example",
  "apiKeyFile": "/data/.openmausbot/providers/keila/api-key",
  "receiptDir": "/data/.openmausbot/keila/receipts",
  "allowedRoots": ["/data/.openmausbot/task-workspaces/LIZ_ID", "/data/.openmausbot/workspaces/LIZ_ID"],
  "protectedIds": ["EXACT_ID_UNDER_USER_HOLD"],
  "allowWrites": true
}
```

`protectedIds` prevents editing those resources, including unsent campaigns on
hold. Populate from current user decisions before wiring the tool. It does not
infer holds from text or authorize new work. Enable this MCP only for the
newsletter executor. Other leads delegate to that executor.

## Workflow

1. `keila_inventory` returns compact metadata for templates, campaigns, senders or
   segments, with bounded automatic pagination.
2. `keila_snapshot` saves an exact provider JSON response into a **new** local file
   and returns its SHA-256. It never overwrites an existing artifact.
3. Assemble an authorized template or draft payload locally. API JSON is the
   object itself; the adapter supplies the outer `data` envelope. Copy approved
   source content, do not rewrite it during installation.
4. Save the manifest below. `payload_sha256` hashes the **raw file bytes**; resource
   and template hashes come from `keila_snapshot` (canonical JSON hashing).
5. Call `keila_prepare` once with `manifest_file`. It verifies the source hash,
   existing provider state, template version, allowed slots, saves a durable
   receipt before mutation and checks a fresh GET against every submitted field.
6. Return the provider URL and compact verified receipt. This proves storage
   integrity only. It is not copy/design approval, rendered-email visual QA,
   delivery verification or authorization to send.

Campaign manifest:

```json
{
  "operation_id": "task-id-approved-draft-v1",
  "resource": "campaigns",
  "action": "create",
  "payload_file": "/ABSOLUTE/WORKSPACE/draft.json",
  "payload_sha256": "SHA256_OF_FILE_BYTES",
  "template_sha256": "HASH_FROM_TEMPLATE_SNAPSHOT",
  "authorization_ref": "conversation/task/source for this exact preparation"
}
```

Draft payload:

```json
{
  "subject": "Exact approved subject",
  "preview_text": "Exact approved preview",
  "settings": {"type": "html"},
  "sender_id": "ms_exact_sender",
  "template_id": "tpl_exact_template",
  "html_content": {"main": "<p>Exact issue copy</p>"},
  "data": {"articles": []}
}
```

Named slot content and `campaign.data` are separate mechanisms; include only what
the selected master uses. Omit `segment_id` only when the preparation task calls
for the whole project list; audience approval is still required before any send.
The adapter does not render Markdown, author HTML, invent a design, choose an
audience, approve content or assess consent.

For a template use `resource: "templates"`, payload
`{"type":"html","name":"Exact version name","html_body":"EXACT HTML"}`,
and add `issue_copy_file` and `reference_html_file` to the manifest. Existing
`newsletter-template-prepare` produces the source; the adapter runs its structural,
copy-separation and reference-class/placeholder preflight before installation.
Retain real slot defaults. New template versions preserve existing masters; update
an existing master only when that exact edit is authorized.

To update, specify `action: "update"`, `id`, and `expected_sha256` from the fresh
resource snapshot. Campaigns must explicitly return both `sent_at: null` and
`scheduled_for: null`. Sent/scheduled/unknown-status or protected resources fail
before a write. The provider lacks a documented conditional-write/ETag contract:
there is still a race with concurrent edits from outside this adapter. The local
exclusive lock prevents adapter operations racing each other. Do not edit the
same resource through another interface during preparation.

## Recovery and limits

Reuse the **same operation ID and identical manifest** for a retry. A verified
operation is reread, not rewritten. A lost create response leaves an uncertain
receipt and blocks recreation; reconcile it with provider inventory and the
stored fingerprint before a maintainer resolves it. Do not evade this by making
another operation ID. An operation with a known resulting ID is safely reread.
Any mismatch requires escalation with its receipt, not speculative repair.

A crash can leave `preparation.lock`; a maintainer first checks its PID and
receipts, then removes it only after proving no write is active. No automatic
lease expiry can cause an overlapping write.

Tests use a local fixture provider and temporary files only:
`node --test deploy/keila/bridge.test.mjs`.
