// Run: cd app && npm test
// Fixtures are real products copied from the embedded price data (Morrisons Stamford Hill online,
// Lidl online range, Lidl receipts) so the parser is checked against how shops really write sizes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {}; // data.js reads window.__FP_DATA__ at import time
const { packSize, sizeText, needAmount, choosePack, normalisePick } = await import('../src/data.js');

const P = (name, price, unitPrice = null, unitLabel = '', extra = {}) => ({ name, price, unitPrice, unitLabel, ...extra });

// [product, expected size or null]
const CASES = [
  // weight / volume in the name
  [P('Tate & Lyle Pure Cane Caster Sugar 1kg', 2.25, 2.25, 'per kg'), { qty: 1, u: 'kg' }],
  [P('Morrisons Mixed Peel 200g', 1.5, 7.5, 'per kg'), { qty: 0.2, u: 'kg' }],
  [P('Plain Flour 1.5kg', 0.7), { qty: 1.5, u: 'kg' }],            // decimals: not "5kg"
  [P('Whole Milk 2.272 litre', 1.65), { qty: 2.272, u: 'l' }],
  [P('Deluxe Chilean Malbec Reserva Privada 2023 75cl', 5.79), { qty: 0.75, u: 'l' }],
  [P('Semi Skimmed Milk 500ml', 0.7), { qty: 0.5, u: 'l' }],
  // multipacks: count x size
  [P('Indus Chopped Tomatoes 12 x 400g', 4, 0.83, 'per kg'), { qty: 4.8, u: 'kg' }],
  [P('Knorr Stock Cubes 8 x 10g Vegetable', 2, 25, 'per kg'), { qty: 0.08, u: 'kg' }],
  [P('Light & Free Strawberry Greek Style Fat Free Yoghurt Multipack 4x115g', 2.5, 5.43, 'per kg'), { qty: 0.46, u: 'kg' }],
  [P('Light & Free Cherry Greek Style Yogurt 4 x 115g (460g)', 2.5, 5.43, 'per kg'), { qty: 0.46, u: 'kg' }], // first size wins, same total
  // a count AND a weight: the weight is the pack size
  [P('Morrisons 10 Pack Unsmoked Back Bacon Rashers 300g', 1.49, 4.97, 'per kg'), { qty: 0.3, u: 'kg' }],
  [P('Oxo Vegetable Stock Cubes 24s 142g', 3.25, 22.89, 'per kg'), { qty: 0.142, u: 'kg' }],
  // the name beats a unit price that disagrees (drained weight in the name's brackets is what's printed)
  [P('Morrisons Whole Carrots (300g)', 0.45, 2.81, 'per kg'), { qty: 0.3, u: 'kg' }],
  // no size in the name: derive from price / unit price
  [P('Morrisons Vegetable Stock Cubes 12\'s', 1.3, 10.83, 'per kg'), { qty: 0.12, u: 'kg' }],
  [P('Knorr Vegetable Stock Pot 4 Pack', 2, 17.86, 'per kg'), { qty: 0.112, u: 'kg' }],
  [P('Morrisons Almonds', 2.33, 11.65, 'per kg'), { qty: 0.2, u: 'kg' }],
  [P('Elephant Atta Wholemeal Chapatti Flour', 9.5, 95, 'per kg'), { qty: 0.1, u: 'kg' }],   // see note below
  [P('Taylor & Colledge Fairtrade Organic Vanilla Bean Extract', 6.5, 65, 'per litre'), { qty: 0.1, u: 'l' }],
  [P('Cadbury Original Drinking Hot Chocolate', 2.25, 9, 'per kg'), { qty: 0.25, u: 'kg' }],
  [P('Deluxe Baklava Assortment', 2.99, 1.2, 'per 100g'), { qty: 0.249, u: 'kg' }],           // per-100g label, size left off the name
  [P('Pouilly-Fumé AOC 0,75 l', 13.99, 1.87, 'per 100ml'), { qty: 0.75, u: 'l' }],            // comma decimal
  [P('ERIDANOUS Feta 400 g', 4.99, 1.25, 'per 100g'), { qty: 0.4, u: 'kg' }],                  // space before the unit
  // counts: loose items and "each" packs
  [P('Morrisons Brown Onions 3 Pack', 0.95, 0.317, 'per each'), { qty: 3, u: 'each' }],
  [P('Morrisons Garlic Bulbs 4 Pack', 0.87, 0.218, 'per each'), { qty: 4, u: 'each' }],
  [P('Golden Kiwi 3 Pack', 1.59), { qty: 3, u: 'each' }],
  [P('Galbani Mozzarella Minis 20\'S', 2.35, 15.67, 'per kg'), { qty: 0.15, u: 'kg' }],       // unit price beats "20's" when it is per kg
  [P('Pomegranate Each', 0.79), { qty: 1, u: 'each' }],
  [P('Ripen at Home Loose Mango Each', 0.75), { qty: 1, u: 'each' }],
  [P('Taylor & Colledge Organic Vanilla Pods', 6.5, 3.25, 'per each'), { qty: 2, u: 'each' }],  // derived count
  // loose by weight from a receipt: any amount
  [P('Loose Baking Potatoes (per kg)', 0.79, 0.79, 'per kg', { source: 'receipt' }), { qty: 1, u: 'kg', loose: true }],
  // unknown
  [P('Betty Crocker Cream Cheese Style Icing', 3.2), null],
  [P('Some Mystery Thing', 1.99), null],
  [null, null],
];

test('packSize on real product names', () => {
  assert.ok(CASES.length >= 15);
  for (const [p, want] of CASES) {
    const got = packSize(p);
    if (want === null) { assert.equal(got, null, p?.name); continue; }
    assert.ok(got, `${p.name}: expected a size`);
    assert.equal(got.u, want.u, p.name);
    assert.ok(Math.abs(got.qty - want.qty) < 0.0006 * Math.max(1, want.qty), `${p.name}: got ${got.qty}, want ${want.qty}`);
    assert.equal(!!got.loose, !!want.loose, p.name);
  }
});

test('sizeText', () => {
  assert.equal(sizeText({ qty: 0.5, u: 'kg' }), '500g');
  assert.equal(sizeText({ qty: 1.5, u: 'kg' }), '1.5kg');
  assert.equal(sizeText({ qty: 0.75, u: 'l' }), '750ml');
  assert.equal(sizeText({ qty: 6, u: 'each' }), '6 pack');
  assert.equal(sizeText({ qty: 1, u: 'each' }), '1 each');
});

test('needAmount converts ingredient lines', () => {
  assert.deepEqual(needAmount({ amount: 500, unit: 'g' }), { qty: 0.5, u: 'kg' });
  assert.deepEqual(needAmount({ amount: 1.5, unit: 'kg' }), { qty: 1.5, u: 'kg' });
  assert.deepEqual(needAmount({ amount: 250, unit: 'ml' }), { qty: 0.25, u: 'l' });
  assert.ok(Math.abs(needAmount({ amount: 3, unit: 'tin' }).qty - 1.2) < 1e-9);   // 400g each
  assert.deepEqual(needAmount({ amount: 4, unit: 'item' }), { qty: 4, u: 'each' });
  assert.equal(needAmount({ amount: 2, unit: 'tsp' }), null);      // you probably have it
  assert.equal(needAmount({ amount: null, unit: '' }), null);
});

// Flour at one shop: a 500g bag, a 1kg bag and a 1.5kg bag.
const flour = [
  P('Homepride Plain Flour 1.5kg', 0.70, 0.47, 'per kg', { match: true }),
  P('Morrisons Plain Flour 500g', 0.53, 1.06, 'per kg', { match: true }),
  P('Allinson Plain Flour 1kg', 1.40, 1.40, 'per kg', { match: true }),
];
const need500 = { item: 'plain flour', amount: 500, unit: 'g' };

test('similar size picks the cheapest pack within 0.85x to 2x', () => {
  const c = choosePack(flour, need500, undefined);
  assert.equal(c.opt.name, 'Morrisons Plain Flour 500g');
  assert.equal(c.count, 1);
  assert.equal(c.big, false);
});

test('cheapest per kg picks the big bag and flags it with the similar alternative', () => {
  const c = choosePack(flour, need500, { mode: 'unit' });
  assert.equal(c.opt.name, 'Homepride Plain Flour 1.5kg');
  assert.equal(c.big, true);
  assert.equal(+c.ratio.toFixed(1), 3);
  assert.equal(c.alt.opt.name, 'Morrisons Plain Flour 500g');
  assert.ok(Math.abs((c.cost - c.alt.cost) - 0.17) < 1e-9); // 17p less with the similar size
});

test('cheapest pack ignores size', () => {
  assert.equal(choosePack(flour, need500, { mode: 'pack' }).opt.name, 'Morrisons Plain Flour 500g');
});

test('never under-buys: 1 litre of milk is not a 1 pint bottle', () => {
  const milk = [P('Whole Milk 1 Pint 568ml', 0.85, 1.5, 'per l', { match: true }), P('Whole Milk 2 Pint 1.13l', 1.2, 1.06, 'per l', { match: true })];
  assert.equal(choosePack(milk, { item: 'whole milk', amount: 1, unit: 'l' }, undefined).opt.name, 'Whole Milk 2 Pint 1.13l');
});

test('several small packs when that is cheaper and still sensible', () => {
  const opts = [P('Chopped Tomatoes 400g', 0.59, 1.48, 'per kg', { match: true }), P('Chopped Tomatoes 6 x 400g', 3.9, 1.63, 'per kg', { match: true })];
  const c = choosePack(opts, { item: 'chopped tomatoes', amount: 3, unit: 'tin' }, undefined); // 1.2kg
  assert.equal(c.count, 3);
  assert.equal(c.opt.name, 'Chopped Tomatoes 400g');
  assert.equal(+c.cost.toFixed(2), 1.77);
});

test('unknown amount or size falls back to the cheapest pack', () => {
  assert.equal(choosePack(flour, { item: 'plain flour', amount: null, unit: '' }, undefined).opt.name, 'Morrisons Plain Flour 500g');
  const opts = [P('Mystery A', 2), P('Mystery B', 1.2)];
  assert.equal(choosePack(opts, need500, undefined).opt.name, 'Mystery B');
  // need in kg, packs sold "each": no size matching, old behaviour for packs/tins
  const c = choosePack([P('Plant Mince 300g', 3)], { item: 'mince', amount: 2, unit: 'pack' }, undefined);
  assert.equal(c.count, 2);
});

test('loose by weight costs the weight you need and is never "too big"', () => {
  const loose = P('Sweet Potatoes (per kg)', 1.19, 1.19, 'per kg', { source: 'receipt', match: true });
  const c = choosePack([loose], { item: 'sweet potatoes', amount: 500, unit: 'g' }, undefined);
  assert.equal(c.big, false);
  assert.equal(+c.cost.toFixed(3), 0.595);
});

test('a price you added wins in every mode; a manual pick wins over that', () => {
  const mine = P('plain flour', 0.4, null, '', { source: 'you', match: true });
  assert.equal(choosePack([mine, ...flour], need500, { mode: 'unit' }).opt.source, 'you');
  assert.equal(choosePack([mine, ...flour], need500, { mode: 'manual', name: 'Allinson Plain Flour 1kg' }).opt.name, 'Allinson Plain Flour 1kg');
});

test('old numeric picks still work', () => {
  assert.deepEqual(normalisePick(0, flour), { mode: 'similar' });
  assert.deepEqual(normalisePick(undefined, flour), { mode: 'similar' });
  // old order was by pack price: 500g (0.53), 1.5kg (0.70), 1kg (1.40)
  assert.equal(choosePack(flour, need500, 1).opt.name, 'Homepride Plain Flour 1.5kg');
  // a manual pick for a product that has gone falls back to similar
  assert.equal(choosePack(flour, need500, { mode: 'manual', name: 'Gone' }).opt.name, 'Morrisons Plain Flour 500g');
});
