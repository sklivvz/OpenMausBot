---
name: copy-preflight
description: Check complete marketing copy with the Jev slop detector before editorial handoff and resolve findings without repeated reviewer loops.
---

# Copy preflight

Chandler owns the quality of the first submitted draft. Read the current brief and corrections before writing, then read the complete piece for meaning, rhythm and specificity before invoking the detector. Darcy should receive a finished piece, not discover a new obvious defect after each point correction.

Call slop-detector.detect_slop once per complete channel asset, with the exact draft, actual channel, concise current brief, sourced facts (including source references and availability), and approved reference text where relevant. Do not send a sanitized excerpt, omit problematic paragraphs or describe an unapproved draft as approved. The tool receives text; it does not fetch documents or inspect images. Follow its explicit size limits; divide longer documents at real section boundaries and review every section, retaining an ordered coverage list and a whole-document editorial read.

Address every revise finding and inspect every review finding in context. Findings identify exact original passages and an editorial action. Preserve the reader, argument, facts, URLs and approved text while correcting the defect. Read the whole piece again after editing, not only the flagged sentence. Check neighboring fragments, repetitive structure, generic filler and newly introduced claims. Use international English, American spelling and metric units; remove regional idioms. A useful short sentence, heading, CTA or dialogue is allowed. Do not pad copy to game the detector.

Recheck the complete revised draft once. Retain the detector JSON beside the copy with its exact draftSha256 and a short disposition for each remaining finding: fixed or reasoned false positive. Any subsequent edit invalidates that receipt for the changed asset. No flags is not editorial sign-off: separately verify source claims, dates, links, spelling, channel counts and any unchanged user wording. A quotation of user-approved text is not authority to rewrite it.

After two checks, resolve remaining clear defects by editorial judgment and report any genuine uncertainty once to Darcy with the exact passage and reason. Do not cycle variants or seek a favorable score. A handoff with a new unreviewed edit must be marked as such. If Jev is unavailable, perform the same source and prose checks, retain the unavailable receipt, and disclose the missing automated check; do not stall the campaign or claim the detector passed.

Darcy reviews the final copy and receipt together; she does not reproduce Chandler's drafting cycle. She may independently call the detector on the actual delivered text. She owns final strategic suitability and reports only unresolved material decisions. A detector result never approves publication or resumes a paused asset. Liz preserves the reviewed version and receipt through production; she routes copy corrections to Chandler and design corrections to Edna.
