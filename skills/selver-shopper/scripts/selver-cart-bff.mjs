import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const origin = 'https://www.selver.ee';

function quantities(lines) {
  if (!Array.isArray(lines)) throw new Error('Selver cart response has no lines');
  const bySku = new Map();
  for (const line of lines) {
    const sku = line?.sku;
    const qty = Number(line?.qty);
    if (typeof sku !== 'string' || !sku || !Number.isFinite(qty) || qty <= 0 || bySku.has(sku)) throw new Error('Selver cart has an invalid or duplicate line');
    bySku.set(sku, qty);
  }
  return bySku;
}

export class SelverCartBff {
  constructor({ token, account, fetcher = fetch }) {
    if (!token || !account || typeof fetcher !== 'function') throw new Error('Authenticated Selver token, account and fetcher required');
    this.token = token;
    this.cartId = null;
    this.account = account;
    this.fetcher = fetcher;
  }

  async request(path, { method = 'GET', body } = {}) {
    if (path !== '/api/user/me') {
      const identity = await this.request('/api/user/me');
      const signedInAs = [identity?.firstname, identity?.lastname].filter(Boolean).join(' ').trim();
      if (signedInAs !== this.account) throw new Error('Selver account differs from the configured account');
    }
    const url = new URL(path, origin);
    url.searchParams.set('token', this.token);
    if (path.startsWith('/api/cart/')) {
      if (!this.cartId) throw new Error('Authenticated account cart is not connected');
      url.searchParams.set('cartId', this.cartId);
    }
    const response = await this.fetcher(url, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 401) throw new Error('Selver session expired or signed out; sign in again and reconnect the browser');
    if (!response.ok) throw new Error(`Selver API returned HTTP ${response.status}`);
    const data = await response.json();
    if (data?.code !== 200) throw new Error('Selver API rejected the request');
    return data.result;
  }

  async read() {
    const identity = await this.request('/api/user/me');
    const signedInAs = [identity?.firstname, identity?.lastname].filter(Boolean).join(' ').trim();
    if (signedInAs !== this.account) throw new Error('Selver account differs from the configured account');
    const accountCart = await this.request('/api/ext/tkg-sales/cart/merge', { method: 'POST', body: {} });
    const canonicalId = String(accountCart?.id ?? '');
    if (!canonicalId) throw new Error('Selver account cart ID is unavailable');
    if (this.cartId && this.cartId !== canonicalId) throw new Error('Selver account cart ID changed');
    this.cartId = canonicalId;
    const first = await this.request('/api/cart/pull');
    const second = await this.request('/api/cart/pull');
    const totals = await this.request('/api/cart/totals');
    const initial = quantities(first);
    const current = quantities(second);
    if (initial.size !== current.size || [...initial].some(([sku, qty]) => current.get(sku) !== qty)) throw new Error('Selver cart changed during read');
    if (!Array.isArray(totals?.items) || !Number.isFinite(Number(totals.grand_total))) throw new Error('Selver totals response is incomplete');
    const ids = new Set(second.map(line => String(line.item_id)));
    if (ids.size !== second.length || totals.items.length !== second.length || totals.items.some(line => !ids.has(String(line.item_id)))) throw new Error('Selver totals differ from cart lines');
    return { signedInAs, cartId: this.cartId, observedAt: new Date().toISOString(), totalEur: Number(totals.grand_total), cart: second.map(line => ({ sku: line.sku, quantity: Number(line.qty), itemId: line.item_id })) };
  }

  async change(sku, quantity) {
    if (typeof sku !== 'string' || !sku || sku.length > 128 || !Number.isFinite(quantity) || quantity < 0) throw new Error('SKU and nonnegative quantity required');
    const before = await this.read();
    const previous = before.cart.find(line => line.sku === sku);
    if (!previous && quantity === 0) throw new Error('SKU is absent from the cart');
    const cartItem = { sku, qty: quantity, quoteId: this.cartId, ...(previous ? { item_id: previous.itemId } : {}) };
    await this.request(quantity === 0 ? '/api/cart/delete' : '/api/cart/update', { method: 'POST', body: { cartItem } });
    const after = await this.read();
    const expected = new Map(before.cart.map(line => [line.sku, line.quantity]));
    if (quantity === 0) expected.delete(sku); else expected.set(sku, quantity);
    const actual = new Map(after.cart.map(line => [line.sku, line.quantity]));
    if (expected.size !== actual.size || [...expected].some(([key, qty]) => actual.get(key) !== qty)) throw new Error('Selver persisted cart differs from requested change');
    return after;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, sku, rawQuantity] = process.argv.slice(2);
  try {
    const sessionPath = process.env.SELVER_SESSION_FILE;
    if (!sessionPath) throw new Error('SELVER_SESSION_FILE is required');
    const client = new SelverCartBff(JSON.parse(readFileSync(sessionPath, 'utf8')));
    const result = command === 'read' ? await client.read()
      : command === 'change' ? await client.change(sku, Number(rawQuantity))
      : null;
    if (result === null) throw new Error('Usage: selver-cart-bff.mjs read | change SKU QUANTITY');
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
