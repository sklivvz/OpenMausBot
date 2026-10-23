import fs from 'node:fs';
import crypto from 'node:crypto';
import Papa from 'papaparse';

export function auditCalendar(text: string, now = new Date(), horizonDays = 7) {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/\r\n/g, '\n'), { header: true, skipEmptyLines: 'greedy' });
  if (parsed.errors.length) throw new Error(`Invalid calendar CSV: ${parsed.errors.map(e => e.message).join('; ')}`);
  for (const field of ['date', 'account', 'utm_content', 'state', 'content_ref', 'approval_ref', 'next_action']) {
    if (!parsed.meta.fields?.includes(field)) throw new Error(`Missing calendar field: ${field}`);
  }
  const today = now.toISOString().slice(0, 10);
  const end = new Date(now.getTime() + horizonDays * 86400000).toISOString().slice(0, 10);
  const seen = new Set<string>();
  const rows = parsed.data.map(row => {
    const key = row.utm_content;
    if (!key || seen.has(key)) throw new Error(`Missing or duplicate calendar key: ${key}`);
    seen.add(key);
    const dated = /^\d{4}-\d{2}-\d{2}$/.test(row.date);
    const state = row.state.trim().toLowerCase();
    const verifiedPublished = state === 'published' && (row.publication_url || '').startsWith('https://');
    const bucket = verifiedPublished ? 'published' : state === 'published_user_reported' ? 'published_user_reported' :
      state === 'sent' ? 'sent_recorded' : state === 'published' ? 'publication_claimed' :
      ['hold', 'paused', 'stopped', 'cancelled', 'canceled'].includes(state) ? 'held' :
      !dated ? 'undated' : row.date < today ? 'overdue' : row.date === today ? 'today' : row.date <= end ? 'next_seven_days' : 'later';
    return { ...row, key, bucket };
  });
  const counts = Object.fromEntries(['overdue', 'today', 'next_seven_days', 'undated', 'later', 'published', 'published_user_reported', 'sent_recorded', 'publication_claimed', 'held'].map(bucket => [bucket, rows.filter(r => r.bucket === bucket).length]));
  return { checkedAt: now.toISOString(), dateBasis: 'UTC dates; exact slot and timezone must be read from the shared calendar', sourceSha256: crypto.createHash('sha256').update(text).digest('hex'), totalRows: rows.length, counts, rows,
    limits: 'Read-only local register inventory. Sent/publication labels and links are recorded evidence, not independently verified delivery or business success. Reconcile missing receipts without sending again. Held rows remain visible with their dates but are not executable overdue work. Reconcile scope with the live shared calendar and latest user decisions. This command neither publishes nor changes state.' };
}

if (process.argv[1]?.endsWith('marketing-calendar-audit')) {
  const source = '/data/.openmausbot/workspaces/6052fe66-7cf6-4106-bdb7-1ddd816647dc/company/marketing/positron-flux-launch/publication-register.csv';
  try {
    if (process.argv.length !== 2) throw new Error('marketing-calendar-audit takes no arguments');
    console.log(JSON.stringify({ source, ...auditCalendar(fs.readFileSync(source, 'utf8')) }));
  } catch (error) {
    console.error(JSON.stringify({ error: String(error), sourceComplete: false }));
    process.exitCode = 1;
  }
}
