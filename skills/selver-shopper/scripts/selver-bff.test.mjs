import assert from 'node:assert/strict';
import test from 'node:test';
import { audit, quote, searchCatalog } from './selver-bff.mjs';

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
