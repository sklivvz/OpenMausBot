---
name: newsletter-platform-production
description: Install a reusable newsletter template separately from issue content, then verify the provider's saved objects.
---

# Newsletter platform production

Edna supplies the reusable visual template and artwork; Chandler supplies issue
copy; Liz installs and assembles their outputs. Darcy owns acceptance and the
business outcome. Preserve the current user instructions and original approval
sources; task-specific decisions are not permanent rules in SOUL.

Understand the objects before opening the editor:
- Template: the reusable design, with its section structure, typography, spacing,
  branding, image positions, footer and designed placeholders/defaults. It is not
  a filled issue and it is not an empty rectangle with a logo.
- Campaign/issue: one edition's subject, preheader, content, images, links and
  selected template. Filling this edition changes the campaign, not the master.
- Delivery: sender, recipients, schedule/send and receipt. A saved template or
  campaign draft is not a sent newsletter.

For Keila HTML templates, one or more named `<keila-content name="...">`
slots contain the reusable default markup. Keila copies their defaults into a new
campaign's editors and replaces each slot with that campaign's `html_content`
value when rendering. Preserve Edna's styled placeholder blocks inside the slots.
The source and tests explicitly support nonempty defaults and multiple slots:
https://github.com/pentacent/keila/blob/main/lib/keila/templates/content_slots.ex
https://github.com/pentacent/keila/blob/main/test/keila/templates/content_slots_test.exs

For example, `<keila-content name="main"><section class="entry"><h2>[Entry
headline]</h2><p>[Entry text]</p></section></keila-content>` is a template. Keep the
section and its styles; a campaign fills the headline/text while preserving the
markup. Do not replace the slot with an empty string or insert the approved issue
into the master. If Edna supplied several editable sections, preserve them;
the platform does not require a single empty main slot.

Use the original reusable source already supplied by Edna. Recover its exact
path/version from the existing handoff. A populated issue export is a different
object; do not derive a new master from it by deleting its body. Retrieve files
you already have directly. A source lookup is not another design assignment.

When the original HTML needs platform slots or asset URLs, use the deterministic
adapter for exact slot wrapping and asset mapping. This adapter does not implement
Liquid-loop conversion; do not treat its restricted input format as a platform
requirement or use it to undo a data-driven template:

```
/usr/local/bin/newsletter-template-prepare DESIGNER_HTML PLAN_JSON ISSUE_COPY NEW_OUTPUT_HTML
```

The plan is `{"slots":[{"name":"edition","content":"[ISSUE DATE]"},
{"name":"main","content":"exact full source markup of the editable body"}],
"assets":[{"from":"./assets/logo.png","to":"https://provider/actual-upload.png"}]}`.
Use exact regions from the source, once each, without overlap. Include editable
date, content, footer and preview-label regions where the original requires
them; every visible placeholder must be inside a slot. Preserve entire styled
blocks as defaults. The tool inserts wrappers; it cannot invent a replacement
design. It reads original assets relative to DESIGNER_HTML and compares their
bytes with the supplied HTTPS URLs before replacement. Upload the actual source
assets first and use the returned final URLs. A mismatch means wrong asset or
unverified hosting, not permission to substitute a similar font or image.
Keep the plan and JSON receipt beside the untouched source. Output must be a new
file. An original that already has correct slots needs preflight only.

When the user requires repeating articles, a fixed pair of example sections is
not a reusable implementation. Keila exposes custom issue data as `campaign.data`
and renders Liquid after merging slots. Use a real loop, for example
`{% for article in campaign.data.articles %}...{% endfor %}`, around the designer's
article markup, with issue-specific fields in the campaign's data. Bind the date
and optional article image/link fields, and omit the image element when absent.
In Keila's Solid engine, use `if article.image_url and article.image_url != blank`;
`image_url != blank` alone rendered an empty-src image for a nil URL in the native
fixture. Check nil, missing and empty image values, not just two articles with images.
Use escaped text values. No fixed issue date, launch artwork or preview annotation
belongs in that repeating master. Explicit user corrections to the supplied
example take precedence over preserving those example bytes. Keep the original
and a precise adaptation record; do not silently substitute design assets.
Native source: https://github.com/pentacent/keila/blob/main/lib/keila/mailings/campaign_renderer.ex
and https://github.com/pentacent/keila/blob/main/lib/keila/mailings/renderer/body_renderer/html.ex.

Verify a repeating template with zero, one and multiple synthetic articles in an
isolated renderer before relying on it, including one article without an image.
The real campaign preview must then show exactly the actual issue's article count
and order. A new issue must work by changing its data, without editing the master.

Before installing a template, run:

```
/usr/local/bin/newsletter-template-preflight TEMPLATE_HTML ISSUE_COPY [REFERENCE_HTML]
```

Use the original designer reference for literal slot wrapping. After an explicitly
required Liquid conversion, reference the reviewed platform template version:
literal label retention is not a test of data binding. Keep the original design
and the adaptation diff as separate evidence. The structural preflight does not
parse/evaluate Liquid or establish correct repetition; those need render evidence.
A failed check identifies a specific repair, not permission to delete design.
Missing local assets require uploading those exact assets and replacing their
paths with the returned hosted URLs. A relative image path is not deployable.
Preserve the designer's original file, the installation copy, and the explicit
asset mapping. Do not replace an image, font, layout or styled placeholder with
something invented. Edna handles actual design changes; Liz owns platform
adaptation. Respect user instructions to use the existing source without asking
Edna again. Only an actually missing or invalid design contribution needs her.

Save in the existing project, then reopen the saved template and capture the actual
stored HTML. Run the same check against that fresh readback, with the original
designer reference, and compare hashes. Check that every original placeholder,
section and image position is still visible in the native template preview.
Use exact editor replacement, not append. Read the editor back before Save and
target the actual Save control in the template form, never a generic submit
button that can select Delete.
Return the native template ID/link and both check receipts. A filled unsaved editor
or preview is not proof of persistence. Do not claim the whole newsletter is ready
when only its template is installed.

For an authorized issue, select that template and populate the campaign's named
slot values with the current exact copy and artwork, retaining the default
markup/styles. Subject and preheader are edition-specific. Inspect the actual
combined desktop/mobile preview; prove that no editorial placeholder, broken
asset, placeholder link or old edition remains. Verify links, sender and recipient
settings against the brief. The reusable template must still contain its defaults
after campaign assembly. Preserve scoped publication
authorization already given. A structural check is neither visual acceptance nor
permission to send. Reconcile uncertain sends by provider receipt before retrying.

An obsolete campaign ID is a reconciliation problem, not a business blocker.
Check the correct project and campaign list. Reuse the matching draft if found;
if no campaign exists and the authorized task includes preparing the newsletter,
create the required draft once, record its actual ID, and continue assembly.
Creating a draft does not send it. Do not report a missing draft as something
Marco must fix. Recheck the current provider account state when an old restriction
is cited; a removed review banner is not an ongoing restriction. Retain genuine
provider refusals with the failing operation and current evidence.

Keep one writer for a platform object. A correction delivered to an existing
thread and a lead's new handoff may refer to the same template or campaign.
Reconcile their latest user instructions and let the existing writer finish its
scoped operation; another thread must not edit that object concurrently or undo
the correction. Return the native object ID and current source version to Darcy.
