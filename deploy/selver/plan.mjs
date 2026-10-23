import { createHash } from 'node:crypto';
import { audit } from '../../skills/selver-shopper/scripts/selver-bff.mjs';

export function digest(value) {
  const canonical = value === null || typeof value !== 'object' ? JSON.stringify(value)
    : Array.isArray(value) ? `[${value.map(item => canonicalJson(item)).join(',')}]` : canonicalJson(value);
  return createHash('sha256').update(canonical).digest('hex');
}
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
function requireValue(condition, message) { if (!condition) throw new Error(message); }
export function skuQuantities(cart) {
  requireValue(Array.isArray(cart) && cart.length <= 200, 'Cart must contain at most 200 lines');
  const result = {};
  for (const line of cart) {
    requireValue(typeof line?.sku === 'string' && /^[\w.-]{1,128}$/.test(line.sku) && !['__proto__', 'constructor', 'prototype'].includes(line.sku), 'Invalid SKU');
    requireValue(!Object.hasOwn(result, line.sku) && Number.isFinite(line.quantity) && line.quantity > 0 && line.quantity <= 10000, 'Invalid or duplicate cart quantity');
    result[line.sku] = line.quantity;
  }
  return result;
}
export function snapshotState(snapshot) {
  requireValue(typeof snapshot?.signedInAs === 'string' && snapshot.signedInAs.length > 0 && snapshot.signedInAs.length <= 200, 'Account required');
  requireValue(typeof snapshot.cartId === 'string' && /^[\w-]{1,128}$/.test(snapshot.cartId), 'Cart ID required');
  requireValue(Number.isFinite(snapshot.totalEur) && snapshot.totalEur >= 0, 'Cart total required');
  return { account: snapshot.signedInAs, cartId: snapshot.cartId, quantities: skuQuantities(snapshot.cart) };
}
export function assertFresh(snapshot, now = Date.now()) {
  const at = Date.parse(snapshot?.observedAt);
  requireValue(Number.isFinite(at) && at <= now + 1000 && now - at <= 120000, 'Cart snapshot is stale');
}
export function makePlan(spec, baseline, expectedSpecHash, now = Date.now()) {
  requireValue(/^[a-f0-9]{64}$/.test(expectedSpecHash) && digest(spec) === expectedSpecHash, 'Fixed specification hash mismatch');
  requireValue(/^[a-f0-9]{64}$/.test(spec.sourceSha256 || ''), 'Source evidence hash required');
  requireValue(!spec.sourceFile && !spec.physicalCart, 'Only embedded fixed specifications are accepted');
  requireValue(Array.isArray(spec.cart) && spec.cart.length > 0 && spec.cart.length <= 100, 'Selection required');
  requireValue(Array.isArray(spec.requirements) && spec.requirements.length <= 100, 'Requirements required');
  skuQuantities(spec.cart);
  for (const requirement of spec.requirements) {
    requireValue(Number.isFinite(requirement?.grams) && requirement.grams > 0 && typeof requirement.name === 'string' && requirement.name.length <= 300 && typeof requirement.id === 'string', 'Invalid requirement');
    requireValue(Array.isArray(requirement.identityTerms) && requirement.identityTerms.length > 0 && requirement.identityTerms.every(term => typeof term === 'string' && term.trim().length > 0), 'Identity terms required');
  }
  for (const line of spec.cart) {
    requireValue(typeof line.name === 'string' && line.name.length <= 500 && Number.isFinite(line.unitPriceEur) && line.unitPriceEur >= 0, 'Invalid selected product');
    requireValue(/^[a-f0-9]{64}$/.test(line.catalogEvidenceSha256 || ''), 'Catalog evidence hash required');
    requireValue(Number.isFinite(line.step) && line.step > 0 && Math.abs(line.quantity / line.step - Math.round(line.quantity / line.step)) < 1e-7, 'Quantity violates selected product step');
    requireValue(line.unit === 'kg' || (line.unit === 'packs' && line.step === 1 && Number.isFinite(line.netGramsPerPack) && line.netGramsPerPack > 0), 'Invalid product unit');
  }
  const audited = audit(spec);
  requireValue(audited.ok, `Fixed shopping audit failed: ${audited.errors.join('; ')}`);
  assertFresh(baseline, now);
  const before = snapshotState(baseline);
  requireValue(before.account === spec.account && before.cartId === spec.cartId, 'Fixed account/cart mismatch');
  const target = { ...before.quantities, ...skuQuantities(spec.cart) };
  const removals = spec.removeSkus || [];
  requireValue(Array.isArray(removals) && removals.length <= 100 && new Set(removals).size === removals.length, 'Invalid removals');
  for (const sku of removals) {
    requireValue(Object.hasOwn(before.quantities, sku) && !spec.cart.some(line => line.sku === sku), 'Removal must name a baseline-only SKU');
    delete target[sku];
  }
  const changes = [...new Set([...Object.keys(before.quantities), ...Object.keys(target)])].sort().filter(sku => (before.quantities[sku] || 0) !== (target[sku] || 0)).map(sku => ({ sku, quantity: target[sku] || 0 }));
  return { version: 1, specHash: expectedSpecHash, before, target, changes, ceilingEur: spec.ceilingEur, estimate: audited, baselineTotalEur: baseline.totalEur };
}
export function verifyFinal(plan, snapshot) {
  assertFresh(snapshot);
  const expected = { account: plan.before.account, cartId: plan.before.cartId, quantities: plan.target };
  return { ok: digest(snapshotState(snapshot)) === digest(expected) && snapshot.totalEur <= plan.ceilingEur,
    exactCart: digest(snapshotState(snapshot)) === digest(expected), totalEur: snapshot.totalEur,
    ceilingEur: plan.ceilingEur, withinBudget: snapshot.totalEur <= plan.ceilingEur, requirementsAudit: plan.estimate };
}
