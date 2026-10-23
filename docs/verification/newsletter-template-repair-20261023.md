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

## Native rendering check

Liz's initial data-driven template used `article.image_url != blank`. In a
network-isolated Solid 1.2.2 render, a three-article fixture with a nil image on
the middle article produced an invalid empty-src image. The tested correction is
`article.image_url and article.image_url != blank`.

`deploy/marketing-calendar/verify-keila-liquid.exs` exercises zero, one and three
articles, including nil, empty and missing image fields. It checks article order,
escaped bodies, expected image counts and unresolved Liquid. All five cases
passed on the corrected template. Run with Elixir 1.18:

```
elixir deploy/marketing-calendar/verify-keila-liquid.exs TEMPLATE_HTML OUTPUT_DIRECTORY
```

The initial dependency installation needs network access. The recorded run used
`elixir:1.18-slim`, Solid 1.2.2, a temporary fixture directory, one CPU and 2 GiB
memory. After dependency preparation, verification ran with Docker networking
disabled and no live application or credentials mounted. This exercises Keila's
Liquid engine, not its full provider UI, delivery or email-client rendering.
The exact correction was delivered to Liz's existing production thread for
installation and fresh provider readback.

## Personalisation and complete review handoff

The saved master initially used `contact.first_name | default: 'there' | escape`.
Solid 1.2.2 preserves whitespace-only names, producing a blank greeting instead
of the fallback. The corrected chain is
`contact.first_name | default: '' | strip | default: 'there' | escape`.

Run the native fixture with `--personalized` to combine the five article/image
cases with eight recipient cases: named, absent, nil, empty, whitespace-only,
padded, Unicode and HTML metacharacters. The old saved master failed the
whitespace case. All forty cases passed after the correction in the same
network-disabled Docker fixture. The tested bytes have SHA-256
`904b123272f01025c0e1cf71c5c639354c9fbad5ce9bd4b530c2e869529c328c`.
Liz reopened the saved provider master and returned that exact hash at
2026-10-23 11:47:01 UTC. This proves the tested template reached the provider;
it does not prove delivery or rendering in recipients' email clients.

The newsletter skill now requires the complete native rendered HTML, full-length
desktop/mobile captures and version evidence for design review. An outer-page
screenshot can clip a scrolling preview iframe. The producer must capture the
whole email, including later articles, CTA and footer. A designer can review
that complete artifact without another provider login; provider persistence and
visual inspection remain separate claims. Keep the existing review assignment
and supply revised evidence rather than creating duplicate review tasks.

The skill replacement/readback and a fake-provider turn passed in an isolated
app fixture. Log:
`/var/folders/m8/7zpq1vyn0g138lf533b16n000000gn/T/openmausbot-verification-evidence/server-1792756096041-145.log`.
The replacement was then installed on Liz and read back exactly, with the prior
skill backed up privately. No application restart was required.
