import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { digest, makePlan, snapshotState } from './plan.mjs';
import { CartReconciler } from './reconcile.mjs';
import { PinnedSelverCart } from './client.mjs';

const hash = 'a'.repeat(64);
function fixed() { return { account: 'Fixture User', cartId: '123', sourceSha256: hash, ceilingEur: 30,
  requirements: [{ id: 'milk', name: 'Milk', grams: 1000, identityTerms: ['milk'], lactoseFree: true }],
  cart: [{ sku: 'MILK', name: 'Lactose-free milk', quantity: 1, step: 1, unit: 'packs', netGramsPerPack: 1000, unitPriceEur: 2, for: ['milk'], catalogEvidenceSha256: hash }] }; }
function snapshot(cart = [{ sku: 'BREAD', quantity: 1 }], totalEur = 4) { return { signedInAs: 'Fixture User', cartId: '123', observedAt: new Date().toISOString(), totalEur, cart }; }
function sandbox(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selver-fixture-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function fake(initial = snapshot()) {
  return { current: initial, writes: [], async read() { return { ...structuredClone(this.current), observedAt: new Date().toISOString() }; },
    async change(sku, quantity, expected) {
      assert.equal(digest(snapshotState(this.current)), digest(expected));
      this.writes.push({ sku, quantity });
      this.current.cart = this.current.cart.filter(line => line.sku !== sku);
      if (quantity) this.current.cart.push({ sku, quantity });
      return this.read();
    } };
}
function plan(spec = fixed(), baseline = snapshot()) { return makePlan(spec, baseline, digest(spec)); }

test('preview preserves unrelated SKUs, records source audit and explicit removals', () => {
  const p = plan();
  assert.deepEqual(p.changes, [{ sku: 'MILK', quantity: 1 }]);
  assert.deepEqual(p.target, { BREAD: 1, MILK: 1 });
  assert.equal(p.estimate.ok, true);
  const spec = { ...fixed(), removeSkus: ['BREAD'] };
  assert.deepEqual(plan(spec).target, { MILK: 1 });
});
test('standalone offline preview needs no credentials and never treats its hash as approval', t => {
  const dir = sandbox(t), spec = path.join(dir, 'spec.json'), baseline = path.join(dir, 'baseline.json');
  fs.writeFileSync(spec, JSON.stringify(fixed()), { mode: 0o600 });
  fs.writeFileSync(baseline, JSON.stringify(snapshot()), { mode: 0o600 });
  const cli = fileURLToPath(new URL('./preview.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, spec, baseline], { encoding: 'utf8', env: {} });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.authority, 'not_assessed'); assert.equal(output.remoteEffects, false);
  assert.deepEqual(output.target, { BREAD: 1, MILK: 1 });
  fs.writeFileSync(baseline, JSON.stringify({ ...snapshot(), observedAt: '2020-01-01' }));
  const stale = spawnSync(process.execPath, [cli, spec, baseline], { encoding: 'utf8', env: {} });
  assert.equal(stale.status, 1); assert.equal(stale.stdout, '');
});
test('rejects tampered intent, stale inputs, ambiguous products, invalid steps and incomplete coverage', () => {
  assert.throws(() => makePlan(fixed(), snapshot(), 'b'.repeat(64)), /hash mismatch/);
  assert.throws(() => plan(fixed(), { ...snapshot(), observedAt: '2020-01-01' }), /stale/);
  for (const mutate of [s => { s.cart[0].quantity = 0.5; }, s => { s.cart[0].name = 'Milk'; }, s => { s.cart[0].for = ['other']; }, s => { s.cart[0].catalogEvidenceSha256 = ''; }, s => { s.requirements[0].identityTerms = ['']; }, s => { s.cart.push(s.cart[0]); }, s => { s.sourceFile = '/tmp/anything'; }]) {
    const spec = fixed(); mutate(spec); assert.throws(() => plan(spec));
  }
});
test('serial application, persistent result and replay do not duplicate writes', async t => {
  const dir = sandbox(t), client = fake(), p = plan();
  let runner = new CartReconciler({ client, stateDir: dir });
  assert.equal((await runner.run(p, 'op')).status, 'achieved');
  runner = new CartReconciler({ client, stateDir: dir });
  assert.equal((await runner.run(p, 'op')).status, 'achieved');
  assert.equal(client.writes.length, 1);
  assert.equal(fs.statSync(path.join(dir, 'op.json')).mode & 0o077, 0);
});
test('baseline conflict stops before a write and protects user changes', async t => {
  const client = fake(snapshot([{ sku: 'BREAD', quantity: 2 }]));
  const runner = new CartReconciler({ client, stateDir: sandbox(t) });
  assert.equal((await runner.run(plan(), 'op')).status, 'conflict');
  assert.equal(client.writes.length, 0);
});
test('successful write with lost response reconciles on restart without retry', async t => {
  const client = fake(), change = client.change.bind(client), dir = sandbox(t), p = plan();
  client.change = async (...args) => { await change(...args); throw new Error('secret transport error'); };
  let runner = new CartReconciler({ client, stateDir: dir });
  const first = await runner.run(p, 'op');
  assert.equal(first.status, 'unknown');
  assert.equal(JSON.stringify(first).includes('secret'), false);
  runner = new CartReconciler({ client, stateDir: dir });
  assert.equal((await runner.run(p, 'op', { reconcileOnly: true })).status, 'achieved');
  assert.equal(client.writes.length, 1);
});
test('unknown unchanged cart never retries an indeterminate write', async t => {
  const client = fake(); let attempts = 0;
  client.change = async () => { attempts++; throw new Error('network'); };
  const runner = new CartReconciler({ client, stateDir: sandbox(t) }), p = plan();
  assert.equal((await runner.run(p, 'op')).status, 'unknown');
  assert.equal((await runner.run(p, 'op')).status, 'unknown');
  assert.equal(attempts, 1);
});
test('cart-wide lock excludes a second operation and stale locks are not stolen', async t => {
  const client = fake(), dir = sandbox(t), runner = new CartReconciler({ client, stateDir: dir });
  let release; const wait = new Promise(resolve => { release = resolve; });
  const read = client.read.bind(client); client.read = async () => { await wait; return read(); };
  const first = runner.run(plan(), 'op');
  await assert.rejects(runner.run(plan(), 'other'), /locked/);
  release(); await first;
  fs.writeFileSync(path.join(dir, 'reconciliation.lock'), '{}');
  await assert.rejects(runner.run(plan(), 'again'), /locked/);
});
test('receipt operation ID is bound to its exact plan', async t => {
  const runner = new CartReconciler({ client: fake(), stateDir: sandbox(t) });
  await runner.run(plan(), 'op');
  const spec = fixed(); spec.ceilingEur = 40;
  await assert.rejects(runner.run(plan(spec), 'op'), /another plan/);
});
test('real final total can fail budget despite valid estimated selection', async t => {
  const client = fake(), original = client.change.bind(client);
  client.change = async (...args) => { await original(...args); client.current.totalEur = 40; };
  const receipt = await new CartReconciler({ client, stateDir: sandbox(t) }).run(plan(), 'op');
  assert.equal(receipt.status, 'verification_failed');
  assert.equal(receipt.verification.withinBudget, false);
});
function provider() {
  const api = { lines: [{ sku: 'BREAD', qty: 1, item_id: 1 }], requests: [] };
  api.fetcher = async (url, options) => {
    api.requests.push({ path: url.pathname, options });
    let result;
    if (url.pathname === '/api/user/me') result = { firstname: 'Fixture', lastname: 'User' };
    else if (url.pathname === '/api/cart/pull') result = structuredClone(api.lines);
    else if (url.pathname === '/api/cart/totals') result = { items: api.lines.map(line => ({ item_id: line.item_id })), grand_total: 4 };
    else if (url.pathname === '/api/cart/update') { const line = JSON.parse(options.body).cartItem; api.lines = api.lines.filter(item => item.sku !== line.sku); api.lines.push({ sku: line.sku, qty: line.qty, item_id: line.item_id || 2 }); result = true; }
    else if (url.pathname === '/api/cart/delete') { const line = JSON.parse(options.body).cartItem; api.lines = api.lines.filter(item => item.sku !== line.sku); result = true; }
    else throw new Error('Unexpected route');
    return new Response(JSON.stringify({ code: 200, result }));
  }; return api;
}
test('real BFF adapter performs full isolated reconciliation without invoking merge', async t => {
  const api = provider(), client = new PinnedSelverCart({ token: 'fixture-token', account: 'Fixture User', cartId: '123', fetcher: api.fetcher });
  const runner = new CartReconciler({ client, stateDir: sandbox(t) });
  assert.equal((await runner.run(plan(fixed(), await client.read()), 'op')).status, 'achieved');
  assert.equal(api.requests.filter(r => r.path === '/api/cart/update').length, 1);
  assert.equal(api.requests.some(r => r.path.includes('merge')), false);
  assert.ok(api.requests.every(r => r.options.redirect === 'error' && r.options.signal));
});
test('BFF adapter rejects changed account and changed preconditions before update', async () => {
  const api = provider(), client = new PinnedSelverCart({ token: 'fixture', account: 'Other User', cartId: '123', fetcher: api.fetcher });
  await assert.rejects(client.read(), /account differs/);
  const valid = new PinnedSelverCart({ token: 'fixture', account: 'Fixture User', cartId: '123', fetcher: api.fetcher });
  await assert.rejects(valid.change('MILK', 1, { ...snapshotState(snapshot()), quantities: {} }), /precondition/);
  assert.equal(api.requests.some(r => r.path === '/api/cart/update'), false);
});
test('CLI preview is deterministic and never needs session credentials', t => {
  const dir = sandbox(t), spec = fixed(), baseline = snapshot();
  for (const [name, value] of Object.entries({ config: { specHash: digest(spec) }, spec, baseline })) fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(value), { mode: 0o600 });
  const main = fileURLToPath(new URL('./main.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [main, 'preview', ...['config', 'spec', 'baseline'].map(name => path.join(dir, name + '.json'))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).target, { BREAD: 1, MILK: 1 });
  fs.chmodSync(path.join(dir, 'config.json'), 0o644);
  const denied = spawnSync(process.execPath, [main, 'apply', ...['config', 'spec', 'baseline'].map(name => path.join(dir, name + '.json')), 'op'], { encoding: 'utf8' });
  assert.equal(denied.status, 1);
});
test('failed reconciliation observation preserves unknown write state', async t => {
  const client = fake(); client.change = async () => { throw new Error('network'); };
  const runner = new CartReconciler({ client, stateDir: sandbox(t) }), p = plan();
  await runner.run(p, 'op'); client.read = async () => { throw new Error('unavailable'); };
  const result = await runner.run(p, 'op', { reconcileOnly: true });
  assert.equal(result.status, 'unknown'); assert.equal(result.pending, 0);
});
test('receipt is durable before provider mutation and crash-state target can reconcile', async t => {
  const client = fake(), dir = sandbox(t), p = plan(), change = client.change.bind(client);
  client.change = async (...args) => {
    const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'op.json'), 'utf8'));
    assert.equal(persisted.status, 'writing'); assert.equal(persisted.pending, 0);
    return change(...args);
  };
  await new CartReconciler({ client, stateDir: dir }).run(p, 'op');
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'op.json'), 'utf8'));
  receipt.completed = 0; receipt.pending = 0; receipt.status = 'writing'; delete receipt.verification;
  fs.writeFileSync(path.join(dir, 'op.json'), JSON.stringify(receipt));
  assert.equal((await new CartReconciler({ client, stateDir: dir }).run(p, 'op')).status, 'achieved');
  assert.equal(client.writes.length, 1);
});
test('BFF response bound and request errors never expose credential-bearing URLs', async () => {
  const client = new PinnedSelverCart({ token: 'secret', account: 'Fixture User', cartId: '123', fetcher: async () => new Response('a'.repeat(1_000_001)) });
  await assert.rejects(client.read(), error => error.message === 'Selver transport outcome unavailable');
  const failed = new PinnedSelverCart({ token: 'secret', account: 'Fixture User', cartId: '123', fetcher: async url => { throw new Error(String(url)); } });
  await assert.rejects(failed.read(), error => !error.message.includes('secret'));
});
test('read-only reconciliation stops after recovery and leaves remaining steps unexecuted', async t => {
  const spec = fixed(); spec.removeSkus = ['BREAD'];
  const p = plan(spec), client = fake(), dir = sandbox(t), change = client.change.bind(client);
  client.change = async (...args) => { await change(...args); throw new Error('response lost'); };
  const runner = new CartReconciler({ client, stateDir: dir });
  assert.equal((await runner.run(p, 'op')).status, 'unknown');
  assert.equal(client.writes.length, 1);
  assert.equal((await runner.run(p, 'op', { reconcileOnly: true })).status, 'ready_to_resume');
  assert.equal(client.writes.length, 1);
  client.change = change;
  assert.equal((await runner.run(p, 'op')).status, 'achieved');
  assert.equal(client.writes.length, 2);
});
test('CLI defaults deny apply before session access', t => {
  const dir = sandbox(t), spec = fixed();
  for (const [name, value] of Object.entries({ config: { specHash: digest(spec), sessionFile: '/missing' }, spec, baseline: snapshot() })) fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(value), { mode: 0o600 });
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./main.mjs', import.meta.url)), 'apply', ...['config', 'spec', 'baseline'].map(name => path.join(dir, name + '.json')), 'op'], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr.includes('/missing'), false);
});
