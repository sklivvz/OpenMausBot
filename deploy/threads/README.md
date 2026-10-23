# Deterministic Threads connector

This adapter handles one text or single-image Threads post, preserving approved
text, account, submitted image hash and alt text. It makes no model calls and
uses no browser. Preparation, unpublished container creation, publication and
read-only reconciliation are separate tools. Both write switches default off.
No production account or post was used to verify this implementation.

## Host setup

Build with `node deploy/threads/build.mjs`; output is
`deploy/local/threads-mcp.cjs`. Register a stdio MCP with an absolute Node command,
the bundle as its only argument, and `THREADS_CONFIG_FILE` pointing to a private
host configuration based on `config.example.json`. The configuration path must
be absolute, resolve outside every artifact root, and name a nonsymlink regular
file with mode 0600 (or stricter), at most 64 KiB. Configuration reads are bounded
even if the file grows while being read. No secret belongs in an MCP
argument, bot workspace, prompt, or tool result. Tool discovery works before
credentials are installed. Actual calls return structured configuration blockers
with MCP `isError: true`; connector-level blocked outcomes use the same error
flag. Successful preparation remains `isError: false`.

The operator provisions a Meta app with the Threads use case and completes
OAuth for the intended account with `threads_basic` and
`threads_content_publish`. Account grant, app eligibility/review, token exchange,
refresh and public image hosting are deployment prerequisites; this adapter does
not implement a login UI or token renewal. Obtain expiry from the provider's
token response, not a guessed lifetime. Store a mode-0600 JSON credential:

```json
{"accessToken":"HOST_PROVISIONED_TOKEN","accountId":"123456789","expiresAt":"2026-10-24T12:00:00Z"}
```

The credential is read on each request, so atomic host rotation needs no restart.
Expired or near-expiry credentials return `credentials_expired`; invalid scopes
or revoked tokens return `provider_auth_or_scope_failed`. Connection status checks
`GET /me` against the configured account ID. Configuration is loaded once per
MCP process; restart that process after changing write switches or account.

Create private grant and receipt directories outside artifact roots. Existing
credential/grant/receipt files must be regular files, not symlinks, and have no
group/other permission bits. Separate the connector's OS identity from agents
with general shell access. Mount credentials and grants read-only to the
connector and make receipt storage writable only by the connector. The configured
artifact roots must already exist; symlinks escaping them are rejected.

**Trust boundary:** paths outside workspaces and mode 0600 are not isolation from
another process with the same UID or unrestricted root shell. The host approval
writer must be inaccessible to bots. Without that isolation and a trusted writer
bound to actual human approval, leave both writes disabled. There is no MCP tool
for minting grants, accepting a caller's `approved: true`, or approving via an
arbitrary reference string. This module does not yet integrate the app's approval
UI; the deployment owner must supply that integration or administer exact grants.

## Exact artifacts and authority

Save exact UTF-8 text and optional image in an allowed artifact root. Compute
SHA-256 over original file bytes, then save an immutable manifest:

```json
{
  "operationId": "campaign-update-threads-001",
  "accountId": "123456789",
  "textFile": "/workspace/approved-threads-artifacts/copy.txt",
  "textSha256": "SHA256_OF_EXACT_COPY_FILE",
  "image": {
    "file": "/workspace/approved-threads-artifacts/image.png",
    "sha256": "SHA256_OF_EXACT_IMAGE_FILE",
    "url": "https://approved-images.example.com/CONTENT_HASH.png",
    "altText": "Exact approved alternative text"
  }
}
```

Omit `image` for text-only. Hash the manifest's exact bytes as `manifestSha256`.
All four operation tools take only `{manifestFile, manifestSha256}`. Preparation
returns validated identities/hashes and never claims publication authority.

After the user approves those exact artifacts for that exact account, a trusted
host writer may create `<grantDir>/<operationId>.json`, mode 0600:

```json
{
  "operationId": "campaign-update-threads-001",
  "manifestSha256": "SHA256_OF_EXACT_MANIFEST_FILE",
  "accountId": "123456789",
  "actions": ["create_container", "publish"],
  "notBefore": "2026-10-23T12:00:00Z",
  "expiresAt": "2026-10-23T13:00:00Z",
  "sourceRef": "HOST_VERIFIED_HUMAN_APPROVAL_RECORD"
}
```

The writer must verify actual approval and record its provenance. `sourceRef` is
an audit pointer, not independent proof. Separate create-only and publish grants
are supported by `actions`. Changed copy, image, account, manifest or expired
window blocks execution. The connector rechecks grants immediately before each
write; revocation cannot recall a request already transmitted to Meta.

## Execution contract

| Tool | Effect |
| --- | --- |
| `threads_connection_status` | Read authenticated identity and write switches |
| `threads_prepare` | Validate local immutable inputs; zero network calls |
| `threads_create_container` | Create one unpublished container under an exact grant |
| `threads_publish` | Publish the ready container once, then read back its post ID |
| `threads_reconcile` | Read existing container or post state; never publish |

The API origin is fixed to `https://graph.threads.net`; no caller-controlled proxy
or arbitrary provider route exists. Read-back verifies post ID, owner ID, exact
text, type, a Threads HTTPS permalink and, for images, exact alt text and presence
of an HTTPS media URL. Private receipts retain the returned fields. Agent results
contain bounded status, IDs, hashes, verified-field names and receipt path.
`published_verified` means those metadata checks passed. It does **not** prove
visual appearance or byte identity after Meta transforms/rehosts an image;
`imageBytesVerification` explicitly states that limit.

Images must be available to Meta from a public HTTPS URL on a host-configured
origin allowlist. Before create and publish, the connector downloads at most
8 MiB with a 20-second timeout and no redirects, and compares the exact hash.
The host must provide immutable content-addressed URLs; a preflight download
cannot prevent the hosting server from changing content before Meta fetches it.
There is no file-upload endpoint in this adapter and no image transformation.

Local conservative policy is 500 **UTF-8 bytes** of nonempty text, at most five
HTTP(S) links, JPEG/PNG signatures up to 8 MiB, and nonempty alt text up to
1000 UTF-8 bytes. These are adapter limits, not a claim that Meta counts UTF-8
bytes or supports every valid file within these bounds. Unsupported inputs block
instead of silently truncating, rewriting or converting. Links remain unchanged
in text; Meta chooses its link preview. Exact preview-card rendering is unverified.
Video, carousel, replies, tagging, analytics, editing, deletion and scheduling are
outside this tool's scope.

## Receipts, retries and blockers

Every provider mutation is preceded by a durable receipt and an exclusive
operation lock. Same operation + same manifest replays the receipt; reusing an
operation with a different manifest fails. Publication is never automatically
retried after transport failure, process interruption, invalid provider response
or failed read-back. Any POST failure is conservatively ambiguous, including
HTTP errors; this sacrifices some recoverability to avoid duplicate publication.

`processing` permits a later read-only reconciliation; each call performs one
status request, not a polling loop. `ready` permits publish with a current grant.
`container_failed` records ERROR/EXPIRED. `published_unverified` has a known post
ID and can be reconciled. `published_mismatch` requires escalation with the
receipt; it never edits or reposts. `creation_unknown`, `publishing`, and
`publish_unknown` prohibit further writes, even if later container status says
FINISHED. An unknown post ID is not guessed from a recent-post search. An operator
must investigate provider evidence; there is no reset-and-republish tool.

A crashed process can leave a lock. `operation_busy_or_stale_lock` requires the
operator to prove that owner process is gone, preserve its receipt and then
remove only that lock. Keep manifests and referenced artifacts available for
reconciliation. Do not delete receipts or invent a new operation ID to bypass an
ambiguous result. A higher layer owns scheduling, escalation and task progress.

## Sources and verification

Contracts inspected on 2026-10-23: [Meta's official collection](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api),
[post details GET](https://www.postman.com/meta/threads/request/34203612-416ad6d2-214e-415a-bfe4-98c959fe25ad),
[container status GET](https://www.postman.com/meta/threads/request/m47wqlq/check-container-s-publishing-status),
and [post list fields/example](https://www.postman.com/meta/threads/request/ozyoo16/get-a-list-of-all-a-user-s-threads).
The collection explicitly documents optional automatic publication on text
container creation; this connector never sends that flag. Meta's developer pages
rate-limited this session; the official collection supplied the request contracts.

Run `node --test deploy/threads/connector.test.mjs`,
`pnpm exec oxlint --deny-warnings deploy/threads`, and the build. HTTP fixtures
use only loopback with synthetic tokens; only the imported test dependency can
replace the fixed origin. Test origin is unavailable through configuration/MCP.
See `verification.md` for the isolated app integration evidence and its limits.
