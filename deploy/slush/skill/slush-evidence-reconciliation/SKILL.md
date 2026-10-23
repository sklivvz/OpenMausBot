---
name: slush-evidence-reconciliation
description: Process saved Slush contact, company-match and sent-request exports; reconcile explicitly evidenced meeting statuses and times without repeated manual row processing.
---

For saved Slush exports, use the offline utility:

```sh
python3 /data/.openmausbot/providers/directory-tools/current/slush/offline.py --manifest /absolute/workspace/manifest.json --output /absolute/workspace/fresh-results
```

Read `/data/.openmausbot/providers/directory-tools/current/slush/README.md`
and the adjacent `manifest.example.json` for the observed TSV columns and the
local meeting-observation contract. Supply actual source event, account and
capture timestamp. That JSON contract is an interchange format, not a Slush API.
Use the summary first, then only the relevant records from `report.json`.

Saved sent-request rows remain claims, not accepted meetings. Incomplete times
stay unknown; do not supply an assumed timezone or treat offered slots as a
confirmed booking. Conflicting current observations remain visible, while older
evidence is retained. The utility makes no provider request or calendar change.
Escalate unresolved identity, acceptance or time evidence to the responsible lead;
use confirmed evidence and existing authority for any later scheduling action.
