---
name: newsletter-platform-production
description: Install a reusable newsletter template separately from issue content, then verify the provider's saved objects.
---

# Newsletter platform production

Edna supplies the reusable visual template and artwork; Chandler supplies issue
copy; Liz installs and assembles their outputs. Darcy owns acceptance and the
business outcome. Preserve the current user instructions and original approval
sources; task-specific decisions are not permanent rules in SOUL.

For Keila, the reusable HTML template contains one empty `<keila-content
name="main"></keila-content>` area, reusable branding and the subscriber footer.
The issue's prose, headings, images and event CTA belong in the campaign content,
not the template. This is the platform's template/content distinction:
https://www.keila.io/updates/ and https://www.keila.io/docs/campaigns/.

Before installing a template, run:

```
/usr/local/bin/newsletter-template-preflight TEMPLATE_HTML ISSUE_COPY
```

A failed check returns concrete defects to the responsible owner. Edna handles
design changes; Liz handles installation and campaign fields. Do not redesign the
template in browser JavaScript. Mechanical installation may replace source asset
paths with the same deployed assets, preserving their bytes and design.

Save in the existing project, then reopen the saved template and capture the actual
stored HTML. Run the same check against that fresh readback and compare hashes.
Return the native template ID/link and both check receipts. A filled unsaved editor
or preview is not proof of persistence. Do not claim the whole newsletter is ready
when only its template is installed.

For an authorized issue, select that template and populate the separate campaign
fields with the current exact copy and artwork. Inspect the actual combined
desktop/mobile preview, links and recipient settings. Preserve scoped publication
authorization already given. A structural check is neither visual acceptance nor
permission to send. Reconcile uncertain sends by provider receipt before retrying.
