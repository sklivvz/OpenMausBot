import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { audit, cartAddScript, cartSetScript, quote, searchCatalog, verifyCartChange, verifyDelivery } from './selver-bff.mjs';

test('catalog search follows pages and exposes the weight-step cost', async () => {
  const calls = [];
  const fetcher = async url => {
    calls.push(Number(url.searchParams.get('from')));
    const offset = Number(url.searchParams.get('from'));
    return { ok: true, json: async () => ({ hits: { total: { value: 2 }, hits: offset === 0
      ? [{ _source: { sku: 'T1', name: 'Turkey', product_sales_unit: 1797, product_weight_step: '1.20', final_price_incl_tax: 18.99 } }]
      : [{ _source: { sku: 'T2', name: 'Turkey 300 g', product_sales_unit: 19, product_net_volume: '300g', final_price_incl_tax: 6.49 } }] } }) };
  };
  const result = await searchCatalog('turkey', { limit: 2, fetcher });
  assert.deepEqual(calls, [0, 1]);
  assert.equal(result.truncated, false);
  assert.deepEqual(quote(result.products[0], 260), { quantity: 1.2, unit: 'kg', purchasedGrams: 1200, estimatedEur: 22.79 });
  assert.deepEqual(quote(result.products[1], 260), { quantity: 1, unit: 'packs', purchasedGrams: 300, estimatedEur: 6.49 });
});

test('audit rejects the observed turkey excess, high total, and unlabeled dairy', () => {
  const result = audit({
    ceilingEur: 100,
    requirements: [
      { id: 'turkey', name: 'Turkey breast', grams: 260, identityTerms: ['kalkuni'], lactoseFree: false },
      { id: 'yogurt', name: 'Greek yogurt', grams: 200, identityTerms: ['jogurt'], lactoseFree: true },
    ],
    cart: [
      { sku: 'T000056480', name: 'Kalkuni rinnafilee', quantity: 1.2, unit: 'kg', unitPriceEur: 18.99, for: ['turkey'] },
      { sku: 'Y', name: 'Kreeka jogurt 200 g', quantity: 1, unit: 'packs', netGramsPerPack: 200, unitPriceEur: 80, for: ['yogurt'] },
    ],
  });
  assert.equal(result.ok, false);
  assert(result.errors.some(error => error.includes('4.62x quantity')));
  assert(result.errors.some(error => error.includes('lactose-free labeling missing')));
  assert(result.errors.some(error => error.includes('exceeds ceiling')));
});

test('audit accepts mapped servings with lactose-free dairy and no excess', () => {
  const result = audit({
    ceilingEur: 20,
    feesEur: 0.5,
    requirements: [
      { id: 'yogurt', name: 'Greek yogurt', grams: 200, identityTerms: ['jogurt'], lactoseFree: true },
      { id: 'skyr', name: 'Skyr equivalent', grams: 100, identityTerms: ['jogurt'], lactoseFree: true },
    ],
    cart: [{ sku: 'Y', name: 'Kreeka jogurt laktoosivaba 350 g', quantity: 1, unit: 'packs', netGramsPerPack: 350, unitPriceEur: 1.39, for: ['yogurt', 'skyr'] }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.totalEur, 1.89);
});

test('audit never drops unresolved manual findings', () => {
  const result = audit({
    ceilingEur: 20,
    fixedSourceIngredientCount: 1,
    manualFailures: ['farro remains unmatched'],
    requirements: [{ id: 'rice', name: 'Rice', grams: 60, identityTerms: ['rice'] }],
    cart: [{ sku: 'R', name: 'Rice 500 g', quantity: 1, unit: 'packs', netGramsPerPack: 500, unitPriceEur: 2, for: ['rice'] }],
  });
  assert.equal(result.ok, false);
  assert(result.errors.includes('unresolved: farro remains unmatched'));
});

test('audit rejects invented requirements and a cart mapping that hides a line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'selver-audit-'));
  try {
    const sourceFile = join(dir, 'source.csv');
    writeFileSync(sourceFile, 'Item,Quantity,Unit,Notes\n"Rice","60","g",""\n');
    const result = audit({
      ceilingEur: 20,
      sourceFile,
      requirements: [
        { id: 'rice', name: 'Rice', grams: 60, identityTerms: ['rice'], source: { Item: 'Rice', Quantity: '60', Unit: 'g' } },
        { id: 'extra', name: 'Extra snack', grams: 1, identityTerms: ['snack'] },
      ],
      cart: [{ sku: 'R', name: 'Rice 500 g', quantity: 1, unit: 'packs', netGramsPerPack: 500, unitPriceEur: 2, for: ['rice'] }],
      physicalCart: [
        { sku: 'R', quantity: 1, unitPriceEur: 2 },
        { sku: 'X', quantity: 1, unitPriceEur: 1 },
      ],
    });
    assert.equal(result.ok, false);
    assert(result.errors.some(error => error.includes('source CSV has 1 items')));
    assert(result.errors.some(error => error.includes('X: audit cost does not match physical cart')));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('delivery rejects a guest or different cart even when the proposed cart passes its audit', () => {
  const spec = {
    targetAccount: 'Marco Cecconi', ceilingEur: 20,
    requirements: [{ id: 'rice', name: 'Rice', grams: 60, identityTerms: ['Rice'] }],
    cart: [{ sku: 'R', name: 'Rice 500 g', quantity: 1, unit: 'packs', netGramsPerPack: 500, unitPriceEur: 2, for: ['rice'] }],
    physicalCart: [{ sku: 'R', quantity: 1, unitPriceEur: 2 }],
  };
  const now = Date.parse('2026-10-18T19:00:00Z');
  const guest = verifyDelivery(spec, { signedInAs: null, observedAt: '2026-10-18T18:59:59Z', totalEur: 2,
    cart: [{ sku: 'R', quantity: 1, unitPriceEur: 2 }] }, now);
  assert.equal(guest.ok, false);
  assert(guest.errors.includes('target account is not verified in the browser'));
  const old = verifyDelivery(spec, { signedInAs: 'Marco Cecconi', observedAt: '2026-10-18T18:55:00Z', totalEur: 209.94,
    cart: [{ sku: 'OLD', quantity: 1, unitPriceEur: 209.94 }] }, now);
  assert.equal(old.ok, false);
  assert(old.errors.includes('target cart snapshot is missing or stale'));
  assert(old.errors.some(error => error.includes('target cart differs')));
  assert(old.errors.some(error => error.includes('target total EUR 209.94')));
});

test('delivery accepts a fresh matching cart in the expected signed-in account', () => {
  const spec = {
    targetAccount: 'Marco Cecconi', ceilingEur: 20,
    requirements: [{ id: 'rice', name: 'Rice', grams: 60, identityTerms: ['Rice'] }],
    cart: [{ sku: 'R', name: 'Rice 500 g', quantity: 1, unit: 'packs', netGramsPerPack: 500, unitPriceEur: 2, for: ['rice'] }],
    physicalCart: [{ sku: 'R', quantity: 1, unitPriceEur: 2 }],
  };
  assert.equal(verifyDelivery(spec, { signedInAs: 'Marco Cecconi', authenticatedByStore: true, cartConnected: true,
    observedAt: '2026-10-18T18:59:59Z', totalEur: 2,
    cart: [{ sku: 'R', quantity: 1, unitPriceEur: 2 }] }, Date.parse('2026-10-18T19:00:00Z')).ok, true);
  assert.equal(verifyDelivery(spec, { signedInAs: 'Marco Cecconi', observedAt: '2026-10-18T18:59:59Z', totalEur: 2,
    cart: [{ sku: 'R', quantity: 1, unitPriceEur: 2 }] }, Date.parse('2026-10-18T19:00:00Z')).ok, false);
});

test('cart operation checks account and full baseline, then awaits Selver sync', async () => {
  const before = { signedInAs: 'Marco Cecconi', observedAt: '2026-10-18T19:00:00Z',
    cart: [{ sku: 'EGGS', quantity: 2 }, { sku: 'MILK', quantity: 1 }] };
  let finish;
  const synced = new Promise(resolve => { finish = resolve; });
  const items = [{ sku: 'EGGS', qty: 2 }, { sku: 'MILK', qty: 1 }];
  const calls = [];
  const getters = { 'user/isLoggedIn': true, 'user/getUserToken': 'token', 'cart/isCartConnected': true, 'cart/getCartToken': 'cart' };
  const context = { location: { origin: 'https://www.selver.ee' }, document: { body: { innerText: 'Tere, Marco Cecconi!' }, querySelector: () => ({ __vue__: {
    $store: { getters,
      state: { cart: { cartItems: items } }, dispatch: async (action, input) => {
      calls.push([action, input]);
      await synced;
      items[0].qty = input.qty;
    } },
  } }) } };
  const operation = runInNewContext(cartSetScript(before, 'EGGS', 1), context);
  let resolved = false;
  operation.then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(resolved, false);
  assert.equal(calls[0][0], 'cart/updateQuantity');
  finish();
  assert.equal(JSON.parse(await operation).serverActionResolved, true);
  assert.equal(items[0].qty, 1);
  getters['user/isLoggedIn'] = false;
  await assert.rejects(runInNewContext(cartSetScript({ ...before, cart: [{ sku: 'EGGS', quantity: 1 }, { sku: 'MILK', quantity: 1 }] }, 'EGGS', 2), context), /not authenticated/);
  context.document.body.innerText = 'LOGI SISSE E-SELVERISSE';
  await assert.rejects(runInNewContext(cartSetScript(before, 'EGGS', 1), context), /account mismatch/);
  assert.equal(calls.length, 1);
});

test('cart change verification rejects delayed or unrelated persisted changes', () => {
  const before = { signedInAs: 'Marco Cecconi', observedAt: '2026-10-18T19:00:00Z',
    cart: [{ sku: 'EGGS', quantity: 2 }, { sku: 'MILK', quantity: 1 }] };
  const after = { signedInAs: 'Marco Cecconi', observedAt: '2026-10-18T19:00:05Z',
    cart: [{ sku: 'EGGS', quantity: 1 }, { sku: 'MILK', quantity: 1 }] };
  const now = Date.parse('2026-10-18T19:00:06Z');
  assert.equal(verifyCartChange(before, after, 'EGGS', 1, now).ok, true);
  assert(verifyCartChange(before, { ...after, cart: [{ sku: 'MILK', quantity: 1 }] }, 'EGGS', 1, now).errors.some(error => error.includes('EGGS: persisted quantity')));
  assert(verifyCartChange(before, { ...after, cart: [{ sku: 'EGGS', quantity: 1 }, { sku: 'MILK', quantity: 0.5 }] }, 'EGGS', 1, now).errors.some(error => error.includes('MILK: persisted quantity')));
  assert(verifyCartChange(before, { ...after, observedAt: before.observedAt }, 'EGGS', 1, now).errors.includes('after snapshot must follow before snapshot'));
});

test('cart addition requires the requested product page and awaits server action', async () => {
  const before = { signedInAs: 'Marco Cecconi', observedAt: '2026-10-18T19:00:00Z', cart: [] };
  const product = { sku: 'MILK', product_sales_unit: 1, qty: 1 };
  let finish;
  const synced = new Promise(resolve => { finish = resolve; });
  const calls = [];
  const context = { location: { origin: 'https://www.selver.ee' }, document: { body: { innerText: 'Tere, Marco Cecconi!' },
    querySelector: () => ({ __vue__: { $store: { getters: { 'user/isLoggedIn': true, 'user/getUserToken': 'token',
      'cart/isCartConnected': true, 'cart/getCartToken': 'cart' }, state: { cart: { cartItems: [] } }, dispatch: async (action, input) => {
      calls.push([action, input]);
      await synced;
    } } } }),
    querySelectorAll: () => [{ __vue__: { getCurrentProduct: product } }],
  } };
  const operation = runInNewContext(cartAddScript(before, 'MILK', 2), context);
  await Promise.resolve();
  assert.equal(calls[0][0], 'cart/addItem');
  assert.equal(calls[0][1].productToAdd.qty, 2);
  finish();
  assert.equal(JSON.parse(await operation).serverActionResolved, true);
  assert.equal(verifyCartChange(before, { signedInAs: 'Marco Cecconi', observedAt: '2026-10-18T19:00:05Z',
    cart: [{ sku: 'MILK', quantity: 2 }] }, 'MILK', 2, Date.parse('2026-10-18T19:00:06Z')).ok, true);
  await assert.rejects(runInNewContext(cartAddScript(before, 'OTHER', 1), context), /not the open product page/);
});
