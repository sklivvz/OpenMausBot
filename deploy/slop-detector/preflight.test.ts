import { describe, expect, it } from 'vitest';
import { briefSchema, checkBrief, constraintsSchema, deterministicChecks } from './preflight.ts';
const brief = { objective: 'Explain the product', audience: 'Engineering directors', deliverable: 'Product overview', kind: 'collateral', owner: 'lead', revision: 'r2', sourceReferences: ['source-message-1'], acceptanceCriteria: ['Explains the supported mechanism'], authorizedOperations: ['review', 'write_copy'], holds: ['publish'], assignment: { operation: 'write_copy', owner: 'writer', role: 'copy', briefRevision: 'r2' } };
describe('brief checks', () => {
  it('allows authorized preparation despite a separate publishing hold', () => {
    expect(checkBrief(brief).status).toBe('structurally_ready');
    expect(checkBrief(brief).authorizationVerified).toBe(false);
  });
  it('returns missing fields and rejects mismatched role, revision and authority', () => {
    expect(checkBrief({}).status).toBe('needs_information');
    const result = checkBrief({ ...brief, assignment: { ...brief.assignment, operation: 'publish', role: 'copy', briefRevision: 'r1' } });
    expect(result.issues.map(i => i.field)).toEqual(['assignment.briefRevision', 'assignment.role', 'assignment.operation', 'holds']);
  });
  it('hashes changes in authority, owner and source version', () => {
    const original = checkBrief(brief).briefSha256;
    for (const changed of [{ owner: 'different' }, { revision: 'r3' }, { authorizedOperations: ['review'] }]) expect(checkBrief({ ...brief, ...changed }).briefSha256).not.toBe(original);
    expect(briefSchema.parse(brief).holds).toEqual(['publish']);
  });
});
describe('explicit copy constraints', () => {
  it('does not invent banned words, rewrite approved copy or flag substrings of words', () => {
    expect(deterministicChecks('This is a revolutionary product.', constraintsSchema.parse({}))).toEqual([]);
    expect(deterministicChecks('words—connected', constraintsSchema.parse({ forbiddenPhrases: ['—'] }))).toHaveLength(1);
    expect(deterministicChecks('redelivery', constraintsSchema.parse({ forbiddenPhrases: ['delivery'] }))).toEqual([]);
    const text = 'Keep this exact phrase.';
    const findings = deterministicChecks(text, constraintsSchema.parse({ forbiddenPhrases: ['exact phrase'], preserveExactly: [text] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].action).toContain('Protected wording takes precedence');
  });
  it('uses Unicode code points and exact URLs, not prefix matches', () => {
    expect(deterministicChecks('😀', constraintsSchema.parse({ maxCharacters: 1 }))).toEqual([]);
    const missing = deterministicChecks('https://example.org/page-other', constraintsSchema.parse({ requiredUrls: ['https://example.org/page'] }));
    expect(missing[0].category).toBe('required_url_missing');
  });
  it('keeps intentional-looking repetition as review rather than a blocking defect', () => {
    const line = 'This repeated statement is long enough to be a useful paragraph.';
    const findings = deterministicChecks(`${line}\n${line}`, constraintsSchema.parse({}));
    expect(findings[0].severity).toBe('review');
  });
});
