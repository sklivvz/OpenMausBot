import assert from 'node:assert/strict';
import test from 'node:test';

import { SelverCartBff } from './selver-cart-bff.mjs';

function fixture({ account = 'Marco Cecconi' } = {}) {
  const state = { lines: [{ sku: 'MILK', qty: 2, item_id: 10 }], writes: [] };
  const fetcher = async (url, options) => {
    assert.equal(url.searchParams.get('token'), 'fixture-token');
    if (url.pathname.startsWith('/api/cart/')) assert.equal(url.searchParams.get('cartId'), 'fixture-cart');
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      state.writes.push({ path: url.pathname, body });
      const line = state.lines.find(item => item.sku === body.cartItem.sku);
      if (url.pathname.endsWith('/delete')) state.lines = state.lines.filter(item => item !== line);
      else if (line) line.qty = body.cartItem.qty;
      else state.lines.push({ sku: body.cartItem.sku, qty: body.cartItem.qty, item_id: 11 });
      return { ok: true, json: async () => ({ code: 200, result: {} }) };
    }
    const result = url.pathname.endsWith('/user/me')
      ? { firstname: account.split(' ')[0], lastname: account.split(' ').slice(1).join(' ') }
      : url.pathname.endsWith('/totals')
      ? { grand_total: state.lines.reduce((sum, item) => sum + item.qty * 2, 0), items: state.lines.map(item => ({ item_id: item.item_id })) }
      : state.lines.map(item => ({ ...item }));
    return { ok: true, json: async () => ({ code: 200, result }) };
  };
  return { client: new SelverCartBff({ token: 'fixture-token', cartId: 'fixture-cart', account: 'Marco Cecconi', fetcher }), state };
}

test('direct BFF change waits for a matching persisted cart', async () => {
  const { client, state } = fixture();
  const result = await client.change('MILK', 1);
  assert.equal(result.cart[0].quantity, 1);
  assert.deepEqual(state.writes, [{ path: '/api/cart/update', body: { cartItem: { sku: 'MILK', qty: 1, quoteId: 'fixture-cart', item_id: 10 } } }]);
});

test('direct BFF refuses another account before writing', async () => {
  const { client, state } = fixture({ account: 'Someone Else' });
  await assert.rejects(client.change('MILK', 1), /account differs/);
  assert.equal(state.writes.length, 0);
});

test('direct BFF refuses a write whose persisted result differs', async () => {
  const { client, state } = fixture();
  const original = client.fetcher;
  client.fetcher = async (url, options) => {
    const result = await original(url, options);
    if (options.method === 'POST') state.lines[0].qty = 2;
    return result;
  };
  await assert.rejects(client.change('MILK', 1), /differs from requested change/);
});
