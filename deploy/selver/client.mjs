import { SelverCartBff } from '../../skills/selver-shopper/scripts/selver-cart-bff.mjs';
import { digest, snapshotState } from './plan.mjs';

export class PinnedSelverCart extends SelverCartBff {
  constructor({ token, account, cartId, fetcher = fetch }) {
    if (!/^[\w-]{1,128}$/.test(cartId || '')) throw new Error('An already connected cart ID is required');
    super({ token, account, fetcher: async (url, options) => {
      if (url.origin !== 'https://www.selver.ee' || !['/api/user/me', '/api/cart/pull', '/api/cart/totals', '/api/cart/update', '/api/cart/delete'].includes(url.pathname)) throw new Error('Unsupported Selver route');
      try {
        const response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
        if (!response.body) throw new Error('Missing body');
        const reader = response.body.getReader();
        const chunks = [];
        let length = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > 1_000_000) throw new Error('Oversized body');
            chunks.push(value);
          }
        } finally { await reader.cancel(); }
        return new Response(Buffer.concat(chunks), { status: response.status });
      }
      catch { throw new Error('Selver transport outcome unavailable'); }
    } });
    this.cartId = cartId;
  }
  async read() {
    const first = await this.request('/api/cart/pull');
    const second = await this.request('/api/cart/pull');
    const totals = await this.request('/api/cart/totals');
    const snapshot = lines => ({ signedInAs: this.account, cartId: this.cartId, observedAt: new Date().toISOString(), totalEur: Number(totals?.grand_total), cart: lines.map(line => ({ sku: line.sku, quantity: Number(line.qty), itemId: line.item_id })) });
    if (!Array.isArray(first) || !Array.isArray(second) || !Array.isArray(totals?.items) || totals?.grand_total == null || !Number.isFinite(Number(totals.grand_total))) throw new Error('Incomplete cart response');
    const observed = snapshot(second);
    if (digest(snapshotState(snapshot(first))) !== digest(snapshotState(observed))) throw new Error('Cart changed during read');
    const ids = new Set(second.map(line => String(line.item_id)));
    if (second.some(line => line.item_id == null) || ids.size !== second.length || totals.items.length !== second.length || new Set(totals.items.map(line => String(line.item_id))).size !== second.length || totals.items.some(line => !ids.has(String(line.item_id)))) throw new Error('Cart totals do not match lines');
    return observed;
  }
  async change(sku, quantity, expectedState) {
    const before = await this.read();
    if (digest(snapshotState(before)) !== digest(expectedState)) throw new Error('Cart precondition changed');
    if (typeof sku !== 'string' || !Number.isFinite(quantity) || quantity < 0) throw new Error('Invalid change');
    const previous = before.cart.find(line => line.sku === sku);
    if (quantity === 0 && !previous) throw new Error('Missing removal SKU');
    const cartItem = { sku, qty: quantity, quoteId: this.cartId, ...(previous ? { item_id: previous.itemId } : {}) };
    await this.request(quantity === 0 ? '/api/cart/delete' : '/api/cart/update', { method: 'POST', body: { cartItem } });
    return this.read();
  }
}
