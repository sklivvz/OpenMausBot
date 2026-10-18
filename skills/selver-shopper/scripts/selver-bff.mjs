import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const endpoint = 'https://www.selver.ee/api/catalog/vue_storefront_catalog_et/product/_search';
const schema = {
  ceilingEur: 110,
  requirements: [{
    id: 'turkey-breast', name: 'Turkey breast', grams: 260,
    identityTerms: ['kalkun'], lactoseFree: false,
  }],
  cart: [{
    sku: 'T000056480', name: 'Kalkuni rinnafilee, RANNAMÕISA, kg',
    quantity: 1.2, unit: 'kg', unitPriceEur: 18.99,
    for: ['turkey-breast'],
  }],
};

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

export function gramsPerPack(product) {
  const value = String(product.product_net_volume || product.product_volume || product.name || '');
  const match = value.match(/(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i);
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  return match[2].toLowerCase() === 'kg' ? amount * 1000 : amount;
}

export function quote(product, requiredGrams) {
  if (!(requiredGrams > 0)) return null;
  const price = Number(product.final_price_incl_tax);
  if (!(price >= 0)) return null;
  if (Number(product.product_sales_unit) === 1797) {
    const stepKg = Number(product.product_weight_step);
    if (!(stepKg > 0)) return null;
    const quantity = round(Math.ceil(requiredGrams / 1000 / stepKg) * stepKg, 3);
    return { quantity, unit: 'kg', purchasedGrams: round(quantity * 1000, 1), estimatedEur: round(quantity * price) };
  }
  const packGrams = gramsPerPack(product);
  if (!(packGrams > 0)) return null;
  const quantity = Math.ceil(requiredGrams / packGrams);
  return { quantity, unit: 'packs', purchasedGrams: round(quantity * packGrams, 1), estimatedEur: round(quantity * price) };
}

export async function searchCatalog(query, { limit = 300, fetcher = fetch } = {}) {
  if (!query || typeof query !== 'string') throw new Error('search query required');
  const products = [];
  let total = Infinity;
  let offset = 0;
  while (offset < Math.min(limit, total)) {
    const url = new URL(endpoint);
    url.searchParams.set('q', query);
    url.searchParams.set('size', String(Math.min(100, limit - offset)));
    url.searchParams.set('from', String(offset));
    const response = await fetcher(url);
    if (!response.ok) throw new Error(`Selver catalog returned ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data?.hits?.hits)) throw new Error('Selver catalog response has no product hits');
    total = Number(data.hits.total?.value ?? data.hits.total);
    if (!Number.isFinite(total)) throw new Error('Selver catalog response has no total');
    const page = data.hits.hits.map(hit => hit._source).filter(product => product && typeof product.sku === 'string');
    products.push(...page);
    offset += data.hits.hits.length;
    if (data.hits.hits.length === 0) break;
  }
  return { products, total, truncated: offset < total };
}

export function audit(spec) {
  const errors = [];
  const detail = [];
  if (!Number.isFinite(spec?.ceilingEur) || spec.ceilingEur <= 0) errors.push('positive ceilingEur required');
  if (!Array.isArray(spec?.requirements) || spec.requirements.length === 0) errors.push('requirements required');
  if (!Array.isArray(spec?.cart)) errors.push('cart required');
  if (errors.length) return { ok: false, errors, totalEur: null, detail };
  if (spec.fixedSourceIngredientCount !== undefined && spec.fixedSourceIngredientCount !== spec.requirements.length) {
    errors.push(`source count ${spec.fixedSourceIngredientCount} differs from ${spec.requirements.length} requirements`);
  }
  if (spec.sourceFile) {
    try {
      const sourceRows = readFileSync(spec.sourceFile, 'utf8').trim().split(/\r?\n/).slice(1).map(line => {
        const match = line.match(/^"((?:[^"]|"")*)","((?:[^"]|"")*)","((?:[^"]|"")*)"(?:,|$)/);
        return match ? match.slice(1).map(value => value.replaceAll('""', '"')) : null;
      });
      if (sourceRows.some(row => !row)) errors.push('source CSV could not be parsed');
      if (sourceRows.length !== spec.requirements.length) errors.push(`source CSV has ${sourceRows.length} items, audit has ${spec.requirements.length}`);
      for (let index = 0; index < Math.min(sourceRows.length, spec.requirements.length); index++) {
        const row = sourceRows[index];
        const item = spec.requirements[index];
        if (row && (item.source?.Item !== row[0] || Number(item.source?.Quantity) !== Number(row[1]) || item.source?.Unit !== row[2])) {
          errors.push(`source item ${index + 1} differs from audit requirement`);
        }
      }
    } catch (error) {
      errors.push(`source CSV unavailable: ${error.message}`);
    }
  }
  if (spec.manualFailures !== undefined) {
    if (!Array.isArray(spec.manualFailures)) errors.push('manualFailures must be an array');
    else errors.push(...spec.manualFailures.map(failure => `unresolved: ${typeof failure === 'string' ? failure : JSON.stringify(failure)}`));
  }

  const requirements = new Map();
  for (const item of spec.requirements) {
    if (!item?.id || !item.name || !(item.grams > 0) || requirements.has(item.id) ||
        !Array.isArray(item.identityTerms) || item.identityTerms.length === 0) {
      errors.push(`invalid requirement ${item?.id || '?'}`);
      continue;
    }
    requirements.set(item.id, item);
  }

  const coverage = new Map([...requirements.keys()].map(id => [id, 0]));
  if (spec.feesEur !== undefined && !(Number.isFinite(spec.feesEur) && spec.feesEur >= 0)) errors.push('feesEur must be nonnegative');
  let totalEur = 0;
  for (const line of spec.cart) {
    const label = line?.sku || '?';
    if (!line?.name || !(line.quantity > 0) || !(line.unitPriceEur >= 0) ||
        !Array.isArray(line.for) || line.for.length === 0) {
      errors.push(`invalid cart line ${label}`);
      continue;
    }
    let purchasedGrams;
    if (line.unit === 'kg') purchasedGrams = line.quantity * 1000;
    else if (line.unit === 'packs' && line.netGramsPerPack > 0) purchasedGrams = line.quantity * line.netGramsPerPack;
    else errors.push(`${label}: unit or netGramsPerPack missing`);
    totalEur += line.quantity * line.unitPriceEur;
    const linked = [...new Set(line.for)];
    if (linked.length !== line.for.length) errors.push(`${label}: duplicate requirement mapping`);
    for (const id of linked) {
      const requirement = requirements.get(id);
      if (!requirement) { errors.push(`${label}: unknown requirement ${id}`); continue; }
      if (!requirement.identityTerms.some(term => line.name.toLocaleLowerCase().includes(term.toLocaleLowerCase()))) {
        errors.push(`${label}: product name does not match ${requirement.name}`);
      }
      if (requirement.lactoseFree && !/laktoosivaba|lactose[ -]?free/i.test(line.name)) {
        errors.push(`${label}: lactose-free labeling missing for ${requirement.name}`);
      }
    }
    if (Number.isFinite(purchasedGrams)) {
      const needed = linked.reduce((sum, id) => sum + (requirements.get(id)?.grams || 0), 0);
      for (const id of linked) coverage.set(id, (coverage.get(id) || 0) + purchasedGrams * (requirements.get(id)?.grams || 0) / needed);
      if (needed > 0) {
        const ratio = purchasedGrams / needed;
        const excessEur = line.quantity * line.unitPriceEur * Math.max(0, 1 - needed / purchasedGrams);
        detail.push({ sku: label, neededGrams: round(needed, 1), purchasedGrams: round(purchasedGrams, 1), ratio: round(ratio), excessEur: round(excessEur) });
        if (ratio > 2 && excessEur > 3) errors.push(`${label}: ${round(ratio)}x quantity, about EUR ${round(excessEur)} surplus`);
      }
    }
  }
  for (const [id, item] of requirements) {
    if ((coverage.get(id) || 0) < item.grams - 0.001) errors.push(`${id}: missing ${round(item.grams - (coverage.get(id) || 0), 1)} g`);
  }
  totalEur = round(totalEur + Number(spec.feesEur || 0));
  if (Array.isArray(spec.physicalCart)) {
    const physical = new Map();
    const mapped = new Map();
    for (const line of spec.physicalCart) physical.set(line.sku, (physical.get(line.sku) || 0) + line.quantity * line.unitPriceEur);
    for (const line of spec.cart) mapped.set(line.sku, (mapped.get(line.sku) || 0) + line.quantity * line.unitPriceEur);
    for (const sku of new Set([...physical.keys(), ...mapped.keys()])) {
      if (Math.abs((physical.get(sku) || 0) - (mapped.get(sku) || 0)) > 0.02) errors.push(`${sku}: audit cost does not match physical cart`);
    }
  }
  if (totalEur > spec.ceilingEur) errors.push(`cart EUR ${totalEur} exceeds ceiling EUR ${spec.ceilingEur}`);
  return { ok: errors.length === 0, totalEur, errors, detail };
}

async function main(args) {
  const [command, value, ...rest] = args;
  if (command === 'schema') { console.log(JSON.stringify(schema, null, 2)); return; }
  if (command === 'audit') {
    if (!value) throw new Error('audit JSON path required');
    const result = audit(JSON.parse(readFileSync(value, 'utf8')));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === 'search') {
    const gramsAt = rest.indexOf('--grams');
    const containsAt = rest.indexOf('--contains');
    const grams = gramsAt >= 0 ? Number(rest[gramsAt + 1]) : null;
    const categoryAt = rest.indexOf('--category');
    const contains = containsAt >= 0 ? rest[containsAt + 1]?.toLocaleLowerCase().split(',').filter(Boolean) : [];
    const category = categoryAt >= 0 ? rest[categoryAt + 1]?.toLocaleLowerCase() : null;
    const catalog = await searchCatalog(value);
    const products = catalog.products.filter(p => contains.every(term => p.name.toLocaleLowerCase().includes(term)) &&
      (!category || p.category?.some(c => c.name?.toLocaleLowerCase().includes(category))));
    const result = products.map(p => ({
      sku: p.sku, name: p.name, priceEur: round(Number(p.final_price_incl_tax)),
      categories: [...new Set((p.category || []).map(c => c.name).filter(Boolean))],
      salesUnit: Number(p.product_sales_unit) === 1797 ? 'kg' : 'packs',
      weightStepKg: p.product_weight_step || null,
      netGramsPerPack: Number(p.product_sales_unit) === 1797 ? null : gramsPerPack(p),
      ...(grams ? { quote: quote(p, grams) } : {}),
    })).sort((a, b) => (a.quote?.estimatedEur ?? Infinity) - (b.quote?.estimatedEur ?? Infinity));
    console.log(JSON.stringify({ query: value, catalogTotal: catalog.total, truncated: catalog.truncated,
      matched: result.length, products: result }, null, 2));
    return;
  }
  throw new Error('use search QUERY [--grams N] [--contains TEXT] [--category TEXT], audit FILE, or schema');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
