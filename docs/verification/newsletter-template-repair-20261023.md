# Newsletter template repair

The previous preflight incorrectly required a single empty content slot. Keila
supports multiple named slots with default markup, and campaign-data Liquid
templates without slots. Requiring an empty body removed the designer's reusable
sections. This was a defect in our checker and standing instructions, not just an
executor error. The earlier template receipt does not establish design fidelity.

The correction is grounded in Keila source revision
`2d9116990a16581cd5349a8b2a5b91fff0f2ba07`:

- `lib/keila/templates/content_slots.ex` and its tests: defaults and named slots.
- `lib/keila/mailings/campaign_renderer.ex`: campaign data supplied to Liquid.
- `lib/keila/mailings/renderer/body_renderer/html.ex`: slot merge, then Liquid;
  a nonempty campaign HTML body overrides the selected template.

The corrected preflight accepts those supported forms. Optional reference checks
detect removed literal placeholders and layout classes. These checks do not prove
full design fidelity or evaluate Liquid. A reviewed Liquid adaptation is a
different reference from its original static design example.

The preparation utility wraps exact, unique source regions in named slots and
replaces relative asset URLs only after checking original/hosted byte equality.
It preserves source files and refuses to overwrite an output. It is for literal
slot adaptation, not arbitrary design changes or converting a fixed example into
a Liquid article loop. Its receipt records source/output hashes and asset mapping.

Run:

```
node --test deploy/marketing-calendar/template-preflight.test.mjs deploy/marketing-calendar/template-prepare.test.mjs
node scripts/build-local-tools.mjs
```

Nineteen tests passed, including designed defaults, multiple slots, native-data
loop recognition, removed placeholders/classes, embedded issue prose, duplicate
or nested slots, wrong hosted asset bytes, overlapping regions and file
preservation. Both bundled CLIs were also exercised with synthetic files in a
network-disabled disposable Docker container. No provider records were mutated.

The isolated app fixture verified exact profile and skill persistence and settled
fake-provider turns. Log:
`/var/folders/m8/7zpq1vyn0g138lf533b16n000000gn/T/openmausbot-verification-evidence/server-1792754380644-99006.log`.

Darcy and Liz's corrected standing instructions and Liz's newsletter skill were
installed and independently read back through the app API. Both utilities were
installed with matching file hashes without restarting the app. Backups are in
the existing private maintenance backup directory. This proves deployed tool and
configuration state, not a successful newsletter send or future agent competence.
