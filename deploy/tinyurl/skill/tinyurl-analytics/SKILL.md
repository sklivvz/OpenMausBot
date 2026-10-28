---
name: tinyurl-analytics
description: Read bounded TinyURL analytics reports and raw logs, or change analytics collection and public sharing for one exact alias through the local authenticated TinyURL tools. Use for exact tinyurl.com links, with no browser or delegation.
---

Use these tools only for the fixed `tinyurl.com` domain. There is no browser,
shell/curl request, delegation or arbitrary endpoint.

- `tinyurl_analytics_report` requires `report` and `from`. Allowed reports:
  `timeline`, `general`, `weekday`, `hour`, `top_sources`, `top_languages`,
  `location`. Send `interval` only for timeline (`minute`, `hour`, `day`, `week`,
  `month`) and `region` only for location (`world` or a two-letter country code).
  `alias` is the bare alias; the connector forms `tinyurl.com/{alias}`.
- `tinyurl_analytics_raw_logs` requires `from` and optionally accepts `to`,
  `alias`, `tag`, `offset` and `limit` (1-1000, default 100). Use `hasMore` and
  `nextOffset` to page; do not ask for an unbounded dump.
- `tinyurl_analytics_status` requires `alias` and boolean `enabled`.
- `tinyurl_analytics_sharing` requires `alias` and boolean `public`.

Reports are bounded and may set `truncated: true`; report that explicitly. If a
mutation returns `write_outcome_unknown`, do not retry and do not create a
replacement alias. Relay the exact code and next action. Token permissions:
Analytics for reads; the relevant update/analytics permission for writes.
