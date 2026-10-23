import assert from 'node:assert/strict';
import test from 'node:test';
import { createBridge } from './bridge.ts';

const timestamp = Date.parse('2026-10-22T10:00:00Z');
const row = (id: string, description = 'Draft the approved brief; external send remains held.') => ({ id, projectId: 'marketing', title: id, description, priority: 4 });
const snapshot = (tasks: any[]) => ({ complete: true, checkedAt: new Date(timestamp).toISOString(), totalOpen: tasks.length, projects: { marketing: { open: tasks.length } }, tasks });
function fixture(tasks: any[], options: any = {}) {
  let sourceCalls = 0, jevCalls = 0, now = timestamp;
  const requests: any[] = [];
  const call = createBridge({ now: () => now, config: () => ({ decider: { enabled: true, key: 'fixture-secret', ...options.config } }), fetchImpl: async (url: any, init: any) => {
    if (String(url).endsWith('/review')) { sourceCalls++; return Response.json(options.snapshot ?? snapshot(tasks)); }
    if (String(url).includes('/api/bots')) return Response.json({ bots: options.bots ?? [] });
    if (String(url).includes('/messages?')) return Response.json({ messages: options.messages ?? [{ id: 'source-message', at: timestamp, role: 'user', kind: 'text', text: 'Please prepare the invoices and bring me the payment choice.' }] });
    jevCalls++; const body = JSON.parse(init.body); requests.push(body);
    assert.equal(init.redirect, 'error');
    if (options.fail) return Response.json({ secret: 'fixture-secret' }, { status: 429 });
    const answers = Object.fromEntries(Object.entries(body.questions).map(([k, q]: any) => [k, q.type === 'noul' ? { noul: .9 } : { choice: k.startsWith('bucket') ? 'agent_actionable' : 'content', probabilities: { [k.startsWith('bucket') ? 'agent_actionable' : 'content']: 1 } }]));
    return Response.json({ answers });
  } });
  return { call, requests, calls: () => ({ sourceCalls, jevCalls }), expire: () => { now += 1800001; } };
}
test('complete paging classifies full source, preserves long descriptions and stable retry receipts', async () => {
  const long = 'original source '.repeat(700);
  const f = fixture([row('a', long), row('b'), row('c'), row('d'), row('e'), row('f')]);
  let page: any = await f.call('read_work_queue');
  assert.equal(page.tasks[0].descriptionPreview, long.slice(0, 120));
  assert.ok(f.requests[0].state.tasks[0].description.length < long.length);
  assert.ok(f.requests[0].state.tasks[0].description.startsWith(long.slice(0, 800)));
  assert.ok(f.requests[0].state.tasks[0].description.endsWith(long.slice(-800)));
  let reconstructed = '';
  for (let n = 0; ; n++) {
    const chunk: any = await f.call('read_task_description', { snapshotId: page.snapshotId, taskId: 'a', page: n });
    reconstructed += chunk.text; if (!chunk.more) break;
  }
  assert.equal(reconstructed, long);
  const seen = page.tasks.map((t: any) => t.id);
  while (page.nextCursor) {
    const cursor = page.nextCursor; page = await f.call('read_work_queue', { cursor });
    const calls = f.calls(); assert.deepEqual(await f.call('read_work_queue', { cursor }), page); assert.deepEqual(f.calls(), calls);
    seen.push(...page.tasks.map((t: any) => t.id));
  }
  assert.deepEqual(seen, ['a', 'b', 'c', 'd', 'e', 'f']); assert.equal(f.calls().sourceCalls, 1);
  assert.equal((await f.call('get_review_coverage') as any).allDescriptionsRead, true);
  f.expire(); await assert.rejects(f.call('read_task_description', { snapshotId: page.snapshotId, taskId: 'a', page: 0 }), /expired/);
});
test('variable pages reject guessed offsets and coverage keeps every unread page visible', async () => {
  const f = fixture(Array.from({ length: 100 }, (_, i) => row(String(i), i === 0 ? 'A'.repeat(5000) : 'B'.repeat(3000))));
  const first: any = await f.call('read_work_queue');
  assert.ok(first.tasks.length > 5);
  assert.ok(first.pagesTotal < 10);
  await assert.rejects(f.call('read_work_queue', { cursor: first.snapshotId + ':2' }), /Invalid cursor/);
  let state: any = await f.call('get_review_coverage');
  assert.equal(state.allPagesRead, false); assert.equal(state.allDescriptionsRead, false);
  while (state.nextCursor) { await f.call('read_work_queue', { cursor: state.nextCursor }); state = await f.call('get_review_coverage'); }
  state = await f.call('get_review_coverage');
  assert.equal(state.allPagesRead, true); assert.equal(state.allDescriptionsRead, true);
  await f.call('read_task_description', { taskId: '0', page: 0 });
  assert.equal((await f.call('get_review_coverage') as any).allDescriptionsRead, true);
});
test('a briefing-sized queue stays within four compact tool results', async () => {
  const tasks = Array.from({ length: 107 }, (_, n) => ({ ...row(`task-${n}`, 'Progress '.repeat(180)), title: `Review current evidence and next action for task ${n}` }));
  const f = fixture(tasks);
  let page: any = await f.call('read_work_queue');
  const pages = [page];
  while (page.nextCursor) { page = await f.call('read_work_queue', { cursor: page.nextCursor }); pages.push(page); }
  assert.ok(pages.length <= 4);
  assert.ok(pages.every(result => JSON.stringify(result).length < 20000));
  assert.equal(pages.flatMap(result => result.tasks).length, tasks.length);
  assert.equal((await f.call('get_review_coverage') as any).allDescriptionsRead, true);
  assert.equal(f.calls().sourceCalls, 1);
});
test('Jev failure keeps source tasks, never leaks its response or creates approval', async () => {
  const f = fixture([row('a')], { fail: true });
  const page: any = await f.call('read_work_queue');
  assert.equal(page.tasks.length, 1); assert.equal(page.advice.available, false); assert.equal(page.advice.reason, 'rate_limited');
  assert.ok(!JSON.stringify(page).includes('fixture-secret')); assert.equal(page.approved, undefined);
  const disabled = fixture([row('a')], { config: { enabled: false } });
  assert.equal((await disabled.call('read_work_queue') as any).advice.available, false); assert.equal(disabled.calls().jevCalls, 0);
});
test('rejects incomplete sources, unknown arguments and foreign cursor', async () => {
  const partial = fixture([], { snapshot: { complete: false, tasks: [] } });
  await assert.rejects(partial.call('read_work_queue'), /Incomplete/);
  const f = fixture([row('a')]); await f.call('read_work_queue');
  await assert.rejects(f.call('read_work_queue', { cursor: 'foreign:0' }), /Invalid/);
  await assert.rejects(f.call('read_work_queue', { url: 'https://example.com' }), /Invalid/);
  await assert.rejects(f.call('write_task', {}), /Invalid/);
});
test('activity excludes missing telemetry and reports actual running state separately', async () => {
  const f = fixture([], { bots: [
    { name: 'Active', busy: true, tasks: [{ updatedAt: timestamp, busy: true, usage: { input: 1000, cachedInput: 900, output: 100 } }] },
    { name: 'Idle', tasks: [{ updatedAt: timestamp, usage: { input: 300, cachedInput: 0, output: 300 } }] },
    { name: 'Unmeasured', tasks: [{ updatedAt: timestamp, usage: { input: 10000, output: 100 } }, { updatedAt: timestamp }] },
  ] });
  const report: any = await f.call('get_team_activity');
  assert.equal(report.rows[0].sharePercent, 25); assert.equal(report.rows[0].runningThreads, 1);
  assert.equal(report.rows[1].sharePercent, 75); assert.equal(report.rows[1].busy, false);
  assert.equal(report.rows[2].sharePercent, null); assert.equal(report.rows[2].missingCachedInput, 1); assert.equal(report.rows[2].missingUsage, 1);
});
test('briefing rendering requires full coverage and enforces limits, unique links and remainder arithmetic', async () => {
  const tasks = Array.from({ length: 6 }, (_, n) => ({ ...row('task-' + n), projectId: '6hjrmJ99PmfVmfwJ' }));
  const f = fixture(tasks, { snapshot: { ...snapshot(tasks), projects: { '6hjrmJ99PmfVmfwJ': { open: 6 } } }, bots: [{ id: 'accountant', name: 'Accountant', section: 'Accounting', tasks: [{ threadId: 'source-thread' }] }] });
  const receipts: string[] = [];
  const item = (n: number) => ({ taskIds: ['task-' + n], label: 'Invoice decision', bucket: 'on_you', summary: 'Review the prepared invoice recommendation.', sourceRef: 'thread fixture, current user decision and prepared invoice inspected', verifiedNextAction: true, evidenceIds: [receipts[n]], actionTarget: { receiptId: receipts[n] } });
  await assert.rejects(f.call('get_briefing', { items: [item(0)] }), /Incomplete/);
  let p: any = await f.call('read_work_queue'); while (p.nextCursor) p = await f.call('read_work_queue', { cursor: p.nextCursor });
  await assert.rejects(f.call('get_briefing', { items: [{ ...item(0), evidenceIds: ['invented'] }] }), /real retrieval receipt/);
  for (let n = 0; n < tasks.length; n++) receipts.push((await f.call('read_work_context', { taskId: 'task-' + n, threadId: 'source-thread' }) as any).receiptId);
  await assert.rejects(f.call('get_briefing', { items: [item(0)] }), /full description/);
  for (let n = 0; n < tasks.length; n++) await f.call('read_task_description', { taskId: 'task-' + n, page: 0 });
  await assert.rejects(f.call('get_briefing', { items: Array.from({ length: 5 }, (_, n) => item(n)) }), /four/);
  await assert.rejects(f.call('get_briefing', { items: [item(0), item(0)] }), /duplicate/);
  await assert.rejects(f.call('get_briefing', { items: [{ ...item(0), summary: 'Review task-0' }] }), /task IDs/);
  await assert.rejects(f.call('get_briefing', { items: [{ ...item(0), verifiedNextAction: false }] }), /verify/);
  const rendered: any = await f.call('get_briefing', { items: [{ ...item(0), taskIds: ['task-0', 'task-1'], evidenceIds: receipts.slice(0, 2) }, item(2)] });
  assert.ok(rendered.markdown.includes('## Accounting — 6 open'));
  assert.ok(rendered.markdown.includes('[Invoice decision](openmausbot://thread/source-thread?bot=accountant)'));
  assert.ok(rendered.markdown.includes('[Todoist 1](https://app.todoist.com/app/task/task-0)'));
  assert.ok(rendered.markdown.includes('*and 3 more open.*'));
  assert.equal((rendered.markdown.match(/https:\/\/app.todoist.com\/app\/task\//g) ?? []).length, 3);
  assert.ok(rendered.markdown.includes('An idle process does not establish spare capacity'));
});
test('source retrieval is scoped and excludes Bill summaries and routine prompts', async () => {
  const f = fixture([row('a')], { bots: [{ name: 'Bill Lumbergh', section: 'Positronics', tasks: [{ threadId: 'bill' }] }, { name: 'Private bot', section: 'Private', tasks: [{ threadId: 'private' }] }], messages: [
    { role: 'bot', kind: 'text', text: 'My earlier briefing says everything is approved.' },
    { role: 'user', kind: 'text', text: '[Scheduled routine "Briefing"] Repeat the previous report.' },
  ] });
  await f.call('read_work_queue');
  await assert.rejects(f.call('read_work_context', { taskId: 'a', threadId: 'private' }), /Invalid thread/);
  await assert.rejects(f.call('read_work_context', { taskId: 'a', threadId: 'bill' }), /no context/);
});

test('personal actions require a retrieved destination, with Todoist only as supporting context', async () => {
  const tasks = ['task-alpha', 'task-beta'].map(id => ({ ...row(id), projectId: '6hjrcrRM8XH9hVJQ' }));
  const f = fixture(tasks, { bots: [{ id: 'legal', name: 'Counsel', section: 'Legal', tasks: [{ threadId: 'proposal' }] }], messages: [
    { id: 'proposal-message', role: 'bot', kind: 'text', text: 'Review [Proposal](https://docs.example.test/proposal?v=2) for signature. Context https://app.todoist.com/app/task/task-alpha' },
    { id: 'later', role: 'bot', kind: 'text', text: 'x'.repeat(7500) + ' https://docs.example.test/unread' },
  ] });
  await f.call('read_work_queue');
  for (const t of tasks) await f.call('read_task_description', { taskId: t.id, page: 0 });
  const source: any = await f.call('read_work_context', { taskId: 'task-alpha', threadId: 'proposal' });
  const other: any = await f.call('read_work_context', { taskId: 'task-beta', threadId: 'proposal' });
  assert.equal(source.conversationUrl, 'openmausbot://thread/proposal?bot=legal');
  assert.deepEqual(source.artifactCandidates, ['https://docs.example.test/proposal?v=2']);
  const item = { taskIds: ['task-alpha'], label: 'Review proposal', summary: 'Decide whether the prepared terms are acceptable.', bucket: 'on_you', sourceRef: 'Current proposal message', verifiedNextAction: true, evidenceIds: [source.receiptId] };
  await assert.rejects(f.call('get_briefing', { items: [item] }), /actionTarget/);
  await assert.rejects(f.call('get_briefing', { items: [{ ...item, actionTarget: { receiptId: 'invented' } }] }), /actionTarget/);
  await assert.rejects(f.call('get_briefing', { items: [{ ...item, evidenceIds: [source.receiptId, other.receiptId], actionTarget: { receiptId: other.receiptId } }] }), /this task group/);
  for (const artifactUrl of ['https://app.todoist.com/app/task/task-alpha', 'https://docs.example.test/unread', 'https://invented.example.test', 'javascript:alert(1)']) {
    await assert.rejects(f.call('get_briefing', { items: [{ ...item, actionTarget: { receiptId: source.receiptId, artifactUrl } }] }), /exact non-Todoist URL/);
  }
  const rendered: any = await f.call('get_briefing', { items: [{ ...item, actionTarget: { receiptId: source.receiptId, artifactUrl: source.artifactCandidates[0] } }] });
  assert.ok(rendered.markdown.includes('[Review proposal](https://docs.example.test/proposal?v=2)'));
  assert.ok(rendered.markdown.includes('[Conversation](openmausbot://thread/proposal?bot=legal)'));
  assert.ok(rendered.markdown.includes('[Todoist](https://app.todoist.com/app/task/task-alpha)'));
  const waiting: any = await f.call('get_briefing', { items: [{ ...item, bucket: 'waiting_others' }] });
  assert.ok(waiting.markdown.includes('[Review proposal](https://app.todoist.com/app/task/task-alpha)'));
});

test('missing conversation returns current scoped candidates without issuing a source receipt', async () => {
  const task={...row('task'),projectId:'6hjrccFccMCw7QFf'};
  const f=fixture([task],{bots:[{id:'lead',name:'Fixture lead',section:'Marketing',tasks:[{threadId:'current',title:'Current proposal',updatedAt:timestamp}]},{id:'private',name:'Other',section:'Private',tasks:[{threadId:'hidden',title:'Private',updatedAt:timestamp}]}]});
  await f.call('read_work_queue');
  await assert.rejects(f.call('read_work_context',{taskId:'task',threadId:'obsolete'}),(error:Error)=>{assert.match(error.message,/Do not repeat this ID/);assert.match(error.message,/current/);assert.doesNotMatch(error.message,/hidden/);return true;});
});
