import { expect, test } from 'vitest';
import { auditCalendar } from './audit.ts';
const header = 'date,account,utm_content,state,content_ref,approval_ref,next_action,publication_url\n';
test('includes every row and keeps held due work visible with multiline source text', () => {
 const a = auditCalendar(header + '2026-10-22,x,invite,hold,draft,,"Review copy, then\nrequest decision",\n2026-10-21,company,old,published,draft,,,\n2026-10-20,company,done,published,draft,,,https://example.com/post\nTBD,company,hire,drafted,draft,,,\n2026-10-29,x,next,drafted,draft,,,\n', new Date('2026-10-22T14:30:00Z'));
 expect(a.totalRows).toBe(5);expect(a.counts).toEqual({overdue:0,today:0,next_seven_days:1,undated:1,later:0,published:1,published_user_reported:0,sent_recorded:0,publication_claimed:1,held:1});
 expect(a.rows[0].next_action).toBe('Review copy, then\nrequest decision');
});
test('retains manual delivery separately from verified publication and overdue work', () => {
 const a = auditCalendar(header+'2026-10-22,x,manual,published_user_reported,a,,verify receipt,\n2026-10-22,x,unverified,published,a,,,\n', new Date('2026-10-23T05:00:00Z'));
 expect(a.rows[0].bucket).toBe('published_user_reported');
 expect(a.counts.published_user_reported).toBe(1);
 expect(a.counts.published).toBe(0);
 expect(a.counts.publication_claimed).toBe(1);
 expect(a.counts.overdue).toBe(0);
});
test('never recycles sent or explicitly stopped work into the overdue queue', () => {
 const a = auditCalendar(header+'2026-10-20,email,issue,sent,receipt,,retain delivery evidence,\n2026-10-20,x,stopped,stopped,a,,user stop,\n2026-10-20,x,ready,drafted,a,,prepare,\n',new Date('2026-10-23T15:00:00Z'));
 expect(a.rows.map(r=>r.bucket)).toEqual(['sent_recorded','held','overdue']);
 expect(Object.values(a.counts).reduce((sum,n)=>sum+n,0)).toBe(3);
});
test('rejects malformed or duplicate source rather than declaring coverage', () => {
 expect(() => auditCalendar('date,state\n2026-10-22,hold')).toThrow('Missing calendar field');
 expect(() => auditCalendar(header+'TBD,x,same,hold,a,,,\nTBD,x,same,hold,a,,,')).toThrow('duplicate');
 expect(() => auditCalendar(header+'"unterminated')).toThrow('Invalid calendar CSV');
});
test('reads CSV assembled with mixed line endings without losing the final quoted row', () => {
 const text = header.replace(/\n/g, '\r\n') + '2026-10-22,x,first,hold,a,,,\r\n"2026-10-23","x","last","hold","b","","review",""\n';
 expect(auditCalendar(text).rows.map(row => row.key)).toEqual(['first', 'last']);
});
