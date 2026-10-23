---
name: websummit-directory-reconciliation
description: Normalize saved Web Summit company and people exports, deduplicate repeated sweeps, and match explicit prospect identities without model-by-model row processing.
---

For saved directory or prospect lists, use the offline utility before manual
matching or another browser sweep:

```sh
python3 /data/.openmausbot/providers/directory-tools/current/websummit/directory.py --manifest /absolute/workspace/manifest.json --output /absolute/workspace/fresh-results
```

Read `/data/.openmausbot/providers/directory-tools/current/websummit/README.md`
for supported columns and use the adjacent `manifest.example.json` to describe
existing source files and exact prospect criteria. Inputs stay inside the
manifest directory; output must be a fresh directory. No network or login is
required. Read `report.json` and the bounded `matches.json` before consuming
`directory.json`; missing report means interrupted output.

Exact person-name matches are candidates, not verified identity. Conflicting
records and unmatched aliases remain uncertain. Reported totals and randomized
sweeps cannot prove directory completeness or attendance. The utility preserves
these distinctions; route only unresolved business relevance or identity
questions to reasoning. It does not send invitations or create meetings.
