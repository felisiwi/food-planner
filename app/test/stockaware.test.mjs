// Run: npm --prefix app test
// The product picker respects the store map: skip products known not to be stocked, but never override a hand pick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockStatus } from '../../lib/storemap.mjs';

globalThis.window = {}; // data.js reads window.__FP_DATA__ at import time
const { choosePack, setData } = await import('../src/data.js');

const P = (name, price, unitPrice) => ({ name, price, unitPrice, unitFixed: true, unitLabel: 'per kg', offer: null, available: true, category: [], source: 'online' });
const GREAT_SCOT = P('Great Scot Red Split Lentils', 1.5, 3);
const MORRISONS = P('Morrisons Wholefoods Red Split Lentils 500g', 2.1, 4.2);
const INDUS = P('Indus Red Split Lentils 1.75kg', 3.25, 1.86);
const lentils = [GREAT_SCOT, MORRISONS, INDUS];
const need = { item: 'red split lentils', amount: 400, unit: 'g' };
const map = {
  zones: [{ id: 'a2', label: 'Aisle 2', walkOrder: 2, signs: [], categories: [] }],
  products: { 'Morrisons Wholefoods Red Split Lentils 500g': { zone: 'a2' } },
  notStocked: { 'Great Scot Red Split Lentils': { checked: '2026-11-12' } },
};

test('stock status: placed = here, listed as absent = not-stocked, otherwise unknown', () => {
  assert.equal(stockStatus('Morrisons Wholefoods Red Split Lentils 500g', map), 'here');
  assert.equal(stockStatus('Great Scot Red Split Lentils', map), 'not-stocked');
  assert.equal(stockStatus('Laila Red Split Lentils 1kg', map), null);
  assert.equal(stockStatus('anything', undefined), null);
  assert.equal(stockStatus('anything', { zones: [], products: {} }), null); // maps without notStocked still work
});

test('without a store map the cheapest suitable pack is chosen as before', () => {
  setData({ storeMap: undefined });
  assert.equal(choosePack(lentils, need, undefined).opt.name, 'Great Scot Red Split Lentils');
});

test('with the map, a product the store does not stock is never chosen automatically', () => {
  setData({ storeMap: map });
  for (const pick of [undefined, { mode: 'similar' }, { mode: 'pack' }, { mode: 'unit' }]) {
    assert.notEqual(choosePack(lentils, need, pick).opt.name, 'Great Scot Red Split Lentils', JSON.stringify(pick));
  }
  assert.equal(choosePack(lentils, need, undefined).opt.name, 'Morrisons Wholefoods Red Split Lentils 500g'); // cheapest of the rest
});

test('a pick made by hand still wins, even for a product the store does not stock', () => {
  setData({ storeMap: map });
  assert.equal(choosePack(lentils, need, { mode: 'manual', name: 'Great Scot Red Split Lentils' }).opt.name, 'Great Scot Red Split Lentils');
});

test('if every option is known not to be stocked, it still picks one rather than nothing', () => {
  setData({ storeMap: map });
  assert.equal(choosePack([GREAT_SCOT], need, undefined).opt.name, 'Great Scot Red Split Lentils');
});

// ---- preferring products checked in the shop ----
const MYSTERY = P('Mystery Red Lentils 500g', 1.2, 2.4); // cheaper than the checked one, never looked up in the shop
const mixed = [MYSTERY, MORRISONS, INDUS];

test('the default pick prefers a product checked in the shop, and says what the cheaper unchecked one is', () => {
  setData({ storeMap: map });
  const c = choosePack(mixed, need, undefined);
  assert.equal(c.opt.name, 'Morrisons Wholefoods Red Split Lentils 500g'); // checked here, though £0.90 dearer
  assert.equal(c.cheaper.opt.name, 'Mystery Red Lentils 500g');
  assert.ok(Math.abs(c.cost - c.cheaper.cost - 0.9) < 1e-9);
});

test('"cheapest pack" and "cheapest per kg" are your choices, so they look at everything', () => {
  setData({ storeMap: map });
  assert.equal(choosePack(mixed, need, { mode: 'pack' }).opt.name, 'Mystery Red Lentils 500g');
  assert.equal(choosePack(mixed, need, { mode: 'unit' }).opt.name, 'Indus Red Split Lentils 1.75kg');
  assert.equal(choosePack(mixed, need, { mode: 'pack' }).cheaper, null);
});

test('no "cheaper" note when the checked product is already the cheapest, or when nothing is checked', () => {
  setData({ storeMap: map });
  assert.equal(choosePack([MORRISONS, INDUS], need, undefined).cheaper, null);
  setData({ storeMap: { zones: [], products: {}, notStocked: {} } }); // a map that has checked nothing
  const c = choosePack(mixed, need, undefined);
  assert.equal(c.opt.name, 'Mystery Red Lentils 500g'); // behaves exactly as before
  assert.equal(c.cheaper, null);
});

test('a pick made by hand beats the preference for checked products', () => {
  setData({ storeMap: map });
  assert.equal(choosePack(mixed, need, { mode: 'manual', name: 'Mystery Red Lentils 500g' }).opt.name, 'Mystery Red Lentils 500g');
});
