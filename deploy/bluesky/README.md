# Bluesky deterministic publisher

This adapter prepares and publishes one exact text/image Bluesky post. Its four
stdio MCP tools are `bluesky_prepare_post`, `bluesky_account_status`,
`bluesky_publish_post` and `bluesky_reconcile_post`. Preparation is local.
Publishing is disabled unless explicitly configured and independently granted.

## Installation and authority

Run `node deploy/bluesky/build.mjs`; register the absolute Node executable with
`deploy/local/bluesky-mcp.cjs` as its argument and `BLUESKY_CONFIG_FILE` pointing
to a host-managed copy of `config.example.json`. Root integration supplies the
shared build/Docker wiring and per-bot tool selection.

Pin the account's verified DID and its actual PDS HTTPS origin. The operator
resolves the handle to DID and checks the DID document's `#atproto_pds` service
before setting this configuration; the tool never follows arbitrary discovery
URLs or silently changes PDS. It rejects redirects and sends account credentials
only to the fixed origin. Literal `http://127.0.0.1` is allowed for fixtures.
Host-controlled HTTPS origins are trusted network destinations; the connector
is not a DNS-rebinding sandbox.

Credentials file format is `{"appPassword":"ACCOUNT_APP_PASSWORD"}`. Use an
app-password, not the primary account password. Credentials and cached sessions
must be mode 0600; state and grant directories must be real paths, mode 0700,
outside all artifact roots. The account DID is the login identifier. The tool
checks returned DID/active state, caches the session privately, and refreshes an
expired access token once. It reports missing/expired authentication rather than
retrying login indefinitely. OAuth is not implemented by this adapter.

Keep `allowPublish: false` until the channel is qualified. The trusted host
approval service/operator, **not Liz or an MCP caller**, creates a private
`GRANT_DIR/OPERATION_ID.json` only from actual user approval:

```json
{
  "operationId": "launch-bsky-01",
  "contentSha256": "EXACT_64_HEX_HASH_FROM_PREPARATION",
  "accountDid": "did:plc:ACCOUNT",
  "pdsUrl": "https://ACCOUNT-PDS.example",
  "notBefore": "2026-10-23T08:00:00Z",
  "expiresAt": "2026-10-23T09:00:00Z",
  "authoritySource": "trusted approval event ID"
}
```

The grant binds the operation, exact copy, facets, paths, media hashes, alt text,
languages and account. It is re-read before each external write. This repository
change does not add a grant issuer or approval UI. A free-form `authoritySource`
is audit provenance inside a **trusted host file**, not proof supplied by an
agent. The MCP exposes no grant-writing tool and rejects unknown caller fields.

**Trust boundary:** host permissions/service isolation must prevent bot shell or
file tools from modifying the configuration, grants, credentials, connector
code and state. 0600 alone does not isolate processes sharing the same OS user.
Mount grants/config read-only into the connector or run it under a separate
service identity; do not enable live publishing with same-user unrestricted bot
shell access to these paths. An external host issuer is a deployment prerequisite.

## Exact execution and recovery

Text is limited to 300 graphemes and 3,000 UTF-8 bytes. Images are limited to four,
2,000,000 bytes each, with nonempty alt text and matching SHA-256. PNG/JPEG/WebP
signature detection is supported; full image decoding, metadata removal and
resizing are not performed. Supply already validated, privacy-reviewed images.
Links require explicit UTF-16 ranges; the tool validates character boundaries,
nonoverlap and HTTPS targets and emits UTF-8 byte facets. Literal URLs without a
link mapping are rejected. Mention resolution, reply/quote posts, video, cards,
external embeds, delete and update are deliberately unsupported.

Preparation persists immutable content and a monotonic TID record key. Publication
uses `putRecord` with `swapRecord: null` and `validate: true`, then reads the record
back and compares the entire record, URI and CID presence. A stable DID permalink
is returned only after matching readback. This proves the record on its PDS, not
AppView indexing, feed reach or an image's visual quality. CID is provider-returned;
the tool does not independently recompute DAG-CBOR CID. It does not claim global
exactly-once delivery.

Private receipts are atomically renamed and fsynced before writes. A global
filesystem lock serializes authentication and operations across processes sharing
state. Concurrent calls return `busy`; stale locks are not automatically stolen.
After a crash an operator establishes the old process is gone, inspects receipts,
removes only that stale `.lock` directory and runs reconciliation.

Any attempted upload/write moves the operation out of `prepared`. Further publish
calls only reconcile the stable record; they never repeat a write or use a new key.
A lost acknowledgement with matching readback becomes verified. Missing readback
remains unresolved, including a subsequently deleted verified post. A conflicting
record is never overwritten. Interrupted image uploads may leave an unreferenced
blob and an unresolved operation; this increment intentionally requires operator
resolution instead of automatically retrying uploads or treating absence as proof
of failure. Different operation IDs are not deduplicated by text similarity.

## Verification and boundaries

Run `node --test deploy/bluesky/bridge.test.mjs` and
`node deploy/bluesky/build.mjs`. Tests use a synthetic loopback PDS and temporary
private state. They exercise media/facets, immutable operations, real HTTP calls,
lost acknowledgements, absent/deleted/conflicting records, wrong account,
redirects, host grants, locks and actual stdio discovery.

The isolated real-app registration/selection check is recorded separately below.
No live Bluesky account login, post or production bot mutation was performed.
Live rollout still requires fixed account/PDS credentials, protected grant
issuance, root build wiring and a user-approved channel qualification post.

## Protocol sources checked 2026-10-23

- [Creating a post](https://bsky.network/docs/bluesky-api/creating-a-post/): facets, image upload and record creation.
- [Post lexicon](https://github.com/bluesky-social/atproto/blob/main/packages/api/lexicons/app/bsky/feed/post.json): 300 graphemes, 3,000 bytes, TID keys.
- [Image lexicon](https://github.com/bluesky-social/atproto/blob/main/packages/api/lexicons/app/bsky/embed/images.json): four images, 2,000,000 bytes.
- [TID specification](https://atproto.com/specs/tid): timestamp and clock encoding.
- [putRecord implementation](https://github.com/bluesky-social/atproto/blob/main/packages/pds/src/api/com/atproto/repo/putRecord.ts) and [repository transaction](https://github.com/bluesky-social/atproto/blob/main/packages/pds/src/actor-store/repo/transactor.ts): null swap refuses an update to different content; identical existing content may be a no-op.
- [API directory](https://bsky.network/docs/api-directory/) and [repository specification](https://atproto.com/specs/repository): session APIs, PDS authority and record operations.

### Isolated app evidence, 2026-10-23

Executed `node --experimental-strip-types scripts/control-omb.ts launch`, then
`node deploy/bluesky/verify-app.mjs http://127.0.0.1:20725` against that disposable
fixture. Registration and actual MCP subprocess discovery returned all four tools;
the fixture bot's prepare/reconcile-only `toolScope` survived API readback. The
rebuilt final bundle was probed again successfully. This verifies registration,
stdio compatibility and selection persistence, not a live-model turn or provider
publication. The source runner refuses non-loopback URLs and requires the single
`Fixture Starter` bot before mutation; operators must still pass only a newly
launched fixture URL.

Evidence log: `/var/folders/m8/7zpq1vyn0g138lf533b16n000000gn/T/openmausbot-verification-evidence/server-1792787107401-27718.log`.
The final focused suite passed 12 tests. Skill frontmatter validation passed.
