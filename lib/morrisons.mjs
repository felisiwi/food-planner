// Morrisons: groceries.morrisons.com search pages embed the product data as
// JSON in window.__INITIAL_STATE__. Prices are national online prices.

export const id = 'morrisons';
export const label = 'Morrisons';
export const searchUrl = (term) => `https://groceries.morrisons.com/search?q=${encodeURIComponent(term)}`;

// Morrisons files some products under promo sections first; skip those so items
// group by their real food section.
const PROMO = /events|inspiration|ways to save|offers|market street|^new|christmas|halloween|easter|summer|bbq|price lock|top picks/i;
const section = (path) => (path || []).filter((c) => !PROMO.test(c)).slice(0, 2);

export function extract(html, n = 12) {
  const start = html.indexOf('__INITIAL_STATE__=');
  if (start < 0) throw new Error('No product data in page (layout may have changed)');
  const end = html.indexOf('</script>', start);
  const state = JSON.parse(html.slice(start + 18, end).trim().replace(/;$/, ''));
  const groups = state.data?.search?.catalogue?.data?.productGroups || [];
  const ents = state.data?.products?.productEntities || {};
  return groups
    .flatMap((g) => g.products)
    .slice(0, n)
    .map((pid) => ents[pid])
    .filter(Boolean)
    .map((x) => ({
      name: x.name?.replace(/\s+/g, ' ').trim(),
      price: Number(x.price?.current?.amount),
      // Unit prices under £1 come in pence (currency "GBX"): store pounds.
      unitPrice: x.price?.unit?.current?.amount
        ? Number(x.price.unit.current.amount) / (x.price.unit.current.currency === 'GBX' ? 100 : 1)
        : null,
      unitFixed: true,
      unitLabel: (x.price?.unit?.label || '').replace('fop.price.per.', 'per '),
      offer: (x.promotions || []).map((p) => p.description || p.name).filter(Boolean).join(' · ') || null,
      available: x.available !== false,
      image: x.image?.src || null,
      category: section(x.categoryPath),
      source: 'online',
    }));
}

// Results cached before the pence fix have unit prices in pence when under £1.
// Repair them: compare with the price implied by the pack size in the name,
// or for "each" prices with the pack count; otherwise a value 20x the pack
// price or more is taken as pence.
export function fixUnit(p) {
  if (!p || p.unitFixed || !p.unitPrice) return p;
  const u = p.unitPrice;
  let pence = false;
  const size = String(p.name).match(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|ltr|litre)\b/i);
  const count = String(p.name).match(/(\d+)\s*(pack|pk|x)\b/i);
  if (size) {
    const qty = Number(size[1]) / (/^(g|ml)$/i.test(size[2]) ? 1000 : 1);
    const expected = qty ? p.price / qty : null;
    if (expected) pence = Math.abs(u / 100 - expected) < Math.abs(u - expected);
  } else if (/each/i.test(p.unitLabel) && count) {
    pence = Math.abs(u / 100 - p.price / Number(count[1])) < Math.abs(u - p.price / Number(count[1]));
  } else pence = u >= 10 && u >= p.price * 20;
  return { ...p, unitPrice: pence ? u / 100 : u, unitFixed: true };
}
