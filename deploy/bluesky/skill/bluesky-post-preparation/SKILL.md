---
name: bluesky-post-preparation
description: Validate and prepare exact Bluesky text, link facets, images and alt text through the local connector before publishing, without making a post.
---

For an exact Bluesky draft, use `bluesky_prepare_post` with the stable task
operation ID, exact copy, approved image hashes/paths and alt text. Link offsets
are UTF-16 start/end positions in the original text; the tool converts them to
UTF-8 facets. Preserve the returned content hash and operation ID. The tool
checks length, media hashes and supported content locally without account login.

Read `/data/.openmausbot/providers/service-connectors/current/deploy/bluesky/README.md`
for schemas and supported content. Preparation is available for the pinned
account `did:plc:3p3k5jzig2uu4oixl4bpyeeg` (`sklivvz.bsky.social`). A different
requested account requires explicit connector configuration, not a rewritten
task or guessed identity.

This installation exposes preparation only. It does not authorize, submit or
schedule publication. Retain the prepared artifact while the lead resolves the
publication route and exact approval. Do not report preparation as a live post,
or call an unavailable API publication tool repeatedly. Keep existing task holds
and publication authority intact.
