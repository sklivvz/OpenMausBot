import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createReader, runScan } from './scan.mjs';
import { OPERATIONS_PROJECT, readTasks, taskReport } from './tasks.mjs';

export function createServer(scan, tasks) {
  let tasksInFlight;
  let inFlight;
  let report;
  let remaining = [];
  let page = 0;
  const nextPage = () => {
    const items = [];
    let size = 0;
    while (remaining.length && items.length < 20) {
      const item = remaining[0];
      const bytes = Buffer.byteLength(JSON.stringify(item));
      if (items.length && size + bytes > 8000) break;
      remaining.shift(); items.push(item); size += bytes;
    }
    return { scannedAt: report.scannedAt, complete: report.complete, notice: report.notice,
      sources: report.sources.map(({ items, ...source }) => ({ ...source, count: items.length })),
      page: ++page, more: remaining.length > 0, items,
      ...(remaining.length ? { nextCommand: '/usr/local/bin/attention-scan-next' } : {}) };
  };
  return http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    if (req.method === 'GET' && req.url === '/health') return res.end('{"ok":true}');
    if (req.method !== 'POST' || !['/scan', '/next', ...(tasks ? ['/tasks', '/operations', '/review'] : [])].includes(req.url)) {
      res.writeHead(404); return res.end('{"error":"Unknown scan operation"}');
    }
    if (req.headers.origin) { res.writeHead(403); return res.end('{"error":"Browser origins are not accepted"}'); }
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 16) { res.writeHead(400); return res.end('{"error":"Scan accepts no arguments"}'); }
    }
    if (body !== '' && body !== '{}') { res.writeHead(400); return res.end('{"error":"Scan accepts no arguments"}'); }
    try {
      if (['/tasks', '/operations', '/review'].includes(req.url)) {
        tasksInFlight ??= tasks().finally(() => { tasksInFlight = undefined; });
        const snapshot = await tasksInFlight;
        return res.end(JSON.stringify(taskReport(snapshot, req.url === '/operations' ? OPERATIONS_PROJECT : undefined, req.url === '/review')));
      }
      if (req.url === '/next') {
        if (!report || inFlight) { res.writeHead(409); return res.end('{"error":"Finish attention-scan before reading its next page"}'); }
        return res.end(JSON.stringify(nextPage()));
      }
      inFlight ??= scan().then(result => {
        report = result;
        remaining = result.sources.flatMap(s => s.items.map(item => ({ source: s.source, ...item })));
        page = 0;
        return nextPage();
      }).finally(() => { inFlight = undefined; });
      res.end(JSON.stringify(await inFlight));
    } catch {
      res.writeHead(502); res.end('{"error":"Attention scan unavailable"}');
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const token = process.env.OMB_COMPOSIO_BROKER_TOKEN;
  const origin = process.env.OMB_COMPOSIO_BROKER_URL;
  if (!token || !origin) throw new Error('Attention scan requires the configured connector service');
  const read = createReader({ url: origin.replace(/\/$/, '') + '/v1/mcp', token });
  const accounts = { gmailWork: process.env.SCAN_GMAIL_WORK, gmailPersonal: process.env.SCAN_GMAIL_PERSONAL,
    slack: process.env.SCAN_SLACK, todoist: process.env.SCAN_TODOIST, slackUser: process.env.SCAN_SLACK_USER };
  if (Object.values(accounts).some(value => !value)) throw new Error('All scan accounts must be configured');
  createServer(() => runScan({ read, accounts }), () => readTasks({ read, account: accounts.todoist })).listen(8798, '127.0.0.1', () => console.log('Read-only attention scanner ready'));
}
