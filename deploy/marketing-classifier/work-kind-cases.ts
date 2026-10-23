export const workKindCases = [
  { id: 'deck-needed-for-launch', request: 'Review the reusable product deck for accuracy. We need it before the launch on Friday. Do not edit it or plan the launch.', expected: 'collateral' },
  { id: 'template-not-send', request: 'Design a reusable newsletter template with labelled placeholders. Do not write this month’s issue or send anything.', expected: 'collateral' },
  { id: 'launch-article-not-campaign', request: 'Write one article explaining what we announced at yesterday’s launch. Deliver the article for review; no campaign planning or publishing.', expected: 'editorial' },
  { id: 'issue-not-template', request: 'Prepare the October newsletter issue using the approved template and supplied stories. Leave the template unchanged.', expected: 'editorial' },
  { id: 'dated-launch-program', request: 'Run the November product launch campaign: coordinate the channel schedule, delegate the announcements, and measure registrations through launch day.', expected: 'campaign' },
  { id: 'scheduled-sequence', request: 'Execute the approved four-channel promotional sequence on its scheduled dates for our November event, collecting publishing receipts.', expected: 'campaign' },
  { id: 'separate-assets-and-campaign', request: 'Create a reusable product one-pager, write an independent customer interview article, and organize the dated launch campaign. These are three separate deliverables.', expected: 'mixed' },
  { id: 'missing-deliverable', request: 'Sort the marketing thing out. You know which one.', expected: 'uncertain' },
  { id: 'valid-style-not-new-kind', request: 'Review this individual article, retaining the author’s short sentences and approved phrase “Not X, but Y.” No rewrite or campaign work is requested.', expected: 'editorial' },
  { id: 'cancelled-context', request: 'Finish the reusable product one-pager for sales.', context: 'The launch was cancelled. Existing publishing holds remain. The product facts were corrected yesterday.', expected: 'collateral' },
] as const;
