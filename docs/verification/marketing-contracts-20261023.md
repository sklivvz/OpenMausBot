# Marketing handoffs and purchase containment, 23 October

Observed failures: permanent SOUL text asserted that C08 was unapproved after
later user decisions; template and populated issue acceptance were conflated;
Liz's platform skill sent unrelated work through launch-specific sources.
Donna submitted an unwanted meal after explicit stops, treating urgency as new
authority. Her ordering conversation was Full Access.

The marketing guide now keeps task decisions in source-linked briefs, separates
reusable template, issue and campaign, and assigns editorial, design and
production checks to their owners. Darcy and Liz's live profiles were replaced
at the conflicting section and read back. Liz's campaign and account-readiness
skills were updated without changing their enabled state. Donna's takeout skill
and profile now preserve food constraints and require renewed concrete basket
approval after a stop or rejection. The ordering thread was changed to Ask with
no remembered permissions. These are instruction changes and containment, not
proof of future compliant purchases or completed marketing objectives.

An isolated server with a temporary home and fake provider verified profile
updates, removal/re-import of the three existing skills, the new newsletter
skill, Ask configuration and settled fake turns. Backups and exact live
readbacks are retained in the private maintenance directory.

`node --test deploy/marketing-calendar/template-preflight.test.mjs` passed six
cases on the host and in an isolated Docker container without network access.
The deterministic utility rejects missing/duplicate content slots, embedded
issue paragraphs, missing unsubscribe variables and local assets. It does not
publish, determine approval, replace visual review, or prove provider persistence.
It passed against Liz's retained reusable-template HTML and approved issue-copy
files. The recorded provider save/readback remains separate evidence.

The utility and Liz's newsletter production skill were installed and read back
without restarting the app. The Docker build recipes include the utility;
the Compose mount takes effect on the next container recreation.
