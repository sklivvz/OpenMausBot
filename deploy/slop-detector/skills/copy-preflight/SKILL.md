---
name: copy-preflight
description: Check complete marketing copy with the Jev slop detector before editorial handoff and resolve findings without repeated reviewer loops.
---

# Copy preflight

Chandler owns the quality of the first submitted draft. Read the current brief and corrections before writing, then read the complete piece for meaning, rhythm and specificity before invoking the detector. Darcy should receive a finished piece, not discover a new obvious defect after each point correction.

Call slop-detector.detect_slop for the complete channel asset. Supply its exact text, current brief, channel, sourced facts and approved reference. Set reviewScope.assetId to the existing assignment's stable asset identifier and reviewScope.briefRevision to the current brief revision. Keep those identifiers across repairs and reviewers; only a real scoped brief correction creates a new revision. A changed draft is not a new brief. The tool limits this scope to two semantic checks and shares exact-input receipts across callers.

Supply constraints from the task: forbiddenPhrases only for explicit wording restrictions (the house em-dash restriction can be expressed as “—”), maxCharacters only when known, preserveExactly for protected user wording, and requiredUrls for exact required links. Do not make up a phrase blacklist or mark all draft text protected. Deterministic failures return before Jev is called. Resolve every listed mechanical issue together within scope, then submit the complete corrected asset. Conflicting protected wording and editing constraints go to the owner; do not silently rewrite either.

A cached receipt retains its original checkedAt and inputTokens; inputTokensThisCall is zero. Any change to the draft, brief, facts, reference or constraints invalidates reuse. The tool does not fetch sources, inspect images or determine authority. For longer documents, split at real section boundaries and retain ordered coverage and a whole-document editorial read.

Address every revise finding and inspect every review finding in context. Findings identify exact original passages and an editorial action. Preserve the reader, argument, facts, URLs and approved text while correcting the defect. Read the whole piece again after editing, not only the flagged sentence. Check neighboring fragments, repetitive structure, generic filler and newly introduced claims. Use international English, American spelling and metric units; remove regional idioms. A useful short sentence, heading, CTA or dialogue is allowed. Do not pad copy to game the detector.

Recheck the complete revised draft once. Retain the detector JSON beside the copy with its exact draftSha256 and a short disposition for each remaining finding: fixed or reasoned false positive. Any subsequent edit invalidates that receipt for the changed asset. No flags is not editorial sign-off: separately verify source claims, dates, links, spelling, channel counts and any unchanged user wording. A quotation of user-approved text is not authority to rewrite it.

On needs_editor, stop classifier retries and resolve remaining clear defects by editorial judgment and report any genuine uncertainty once to Darcy with the exact passage and reason. Do not cycle variants or seek a favorable score. A handoff with a new unreviewed edit must be marked as such. If Jev is unavailable, perform the same source and prose checks, retain the unavailable receipt, and disclose the missing automated check; do not stall the campaign or claim the detector passed.

For a narrow repair, Chandler may use an available permitted executor with the exact draft, findings, sources and protected wording, then check its returned artifact. Do not send the whole conversation or ask the executor to redesign the message. Facts and meaning still need writer review.

Darcy reviews the final copy and receipt together; she does not reproduce Chandler's drafting cycle. She may independently call the detector on the actual delivered text. She owns final strategic suitability and reports only unresolved material decisions. A detector result never approves publication or resumes a paused asset. Liz preserves the reviewed version and receipt through production; she routes copy corrections to Chandler and design corrections to Edna.
