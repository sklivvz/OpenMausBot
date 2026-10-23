import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const sha256 = text => createHash('sha256').update(text).digest('hex');

export function prepareSkillTextPlan({ text, expectedSha256, replacements }) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 256_000 || !/^[a-f0-9]{64}$/.test(expectedSha256 ?? '')) throw Error('Invalid bounded skill snapshot');
  if (sha256(text) !== expectedSha256) throw Error('Skill changed since review; no replacement prepared');
  if (!Array.isArray(replacements) || !replacements.length || replacements.length > 16) throw Error('Supply 1–16 exact reviewed replacements');
  const edits = replacements.map(({ before, after }) => {
    if (typeof before !== 'string' || !before.length || typeof after !== 'string') throw Error('Invalid replacement');
    const start = text.indexOf(before);
    if (start < 0 || text.indexOf(before, start + 1) >= 0) throw Error('Replacement must match exactly one original span');
    return { start, end: start + before.length, after };
  }).sort((a, b) => a.start - b.start);
  if (edits.some((edit, index) => index > 0 && edit.start < edits[index - 1].end)) throw Error('Replacement spans overlap');
  let next = text;
  for (const edit of edits.toReversed()) next = next.slice(0, edit.start) + edit.after + next.slice(edit.end);
  if (Buffer.byteLength(next) > 256_000) throw Error('Replacement exceeds size bound');
  return { mode: 'plan_only', expectedSha256, proposedSha256: sha256(next), text: next, changed: next !== text,
    limitation: 'No files or server state changed. Recheck the live hash before installation; this plan is not an atomic server compare-and-swap.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw Error('Usage: node deploy/agentic/skill-text-plan.mjs INPUT.json');
    if (fs.statSync(process.argv[2]).size > 1_500_000) throw Error('Plan input exceeds size bound');
    const plan = prepareSkillTextPlan(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
    process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
