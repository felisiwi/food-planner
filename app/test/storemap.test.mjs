// Run: npm --prefix app test
// Zone resolution precedence, walk-order learning and trip recording (lib/storemap.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EMPTY_MAP, resolvePlace, zoneForCategory, placeText, zoneHeading, learnOrder, zoneRanker, groupByZone, recordPick, makeTag, customId,
} from '../../lib/storemap.mjs';

const sample = JSON.parse(readFileSync(new URL('../../store-map/sample.json', import.meta.url), 'utf8'));
const skeleton = JSON.parse(readFileSync(new URL('../../store-map/stamford-hill.json', import.meta.url), 'utf8'));
const TINS = ['Food Cupboard', 'Tins, Cans & Packets'];
const CARROTS = 'Morrisons Whole Carrots (300g)';

test('the shipped skeleton is a valid empty map', () => {
  assert.deepEqual(skeleton.zones, []);
  assert.deepEqual(skeleton.products, {});
});

test('category matching: full path beats second level beats top level', () => {
  assert.equal(zoneForCategory(TINS, sample.zones).id, 'a7');
  assert.equal(zoneForCategory(['Fresh Fruit & Veg', 'Vegetables'], sample.zones).id, 'fv'); // top level only
  // "Sugar & Sweeteners" is listed as a full path for a9; the full path is tried first
  assert.equal(zoneForCategory(['Food Cupboard', 'Sugar & Sweeteners'], sample.zones).id, 'a9');
  assert.equal(zoneForCategory(['Pet Shop', 'Dog & Puppy'], sample.zones), null);
  assert.equal(zoneForCategory([], sample.zones), null);
  assert.equal(zoneForCategory(TINS, []), null);
});

test('precedence: your tag > map product > category > nothing', () => {
  const places = { [CARROTS]: { zone: 'a9', side: 'left', shelf: 'top', note: 'moved', at: 1 } };
  // 1. your tag wins over the map's own product entry (which says fv)
  const a = resolvePlace(CARROTS, ['Fresh Fruit & Veg', 'Vegetables'], places, sample);
  assert.equal(a.zone.id, 'a9'); assert.equal(a.source, 'you'); assert.equal(a.side, 'left');
  // 2. no tag: the map's product entry beats the category (category alone would also say fv here, so check the detail)
  const b = resolvePlace(CARROTS, TINS, {}, sample);
  assert.equal(b.zone.id, 'fv'); assert.equal(b.source, 'map'); assert.equal(b.shelf, 'bottom'); assert.equal(b.note, 'loose veg bins');
  // 3. neither: the category decides, with no side or shelf
  const c = resolvePlace('Some Tinned Beans 400g', TINS, {}, sample);
  assert.equal(c.zone.id, 'a7'); assert.equal(c.source, 'category'); assert.equal(c.side, '');
  // 4. nothing known
  const d = resolvePlace('Dog food', ['Pet Shop', 'Dog & Puppy'], {}, sample);
  assert.equal(d.zone, null); assert.equal(d.source, null);
});

test('an empty map places nothing, but your tags still work (custom aisle)', () => {
  assert.equal(resolvePlace('Beans', TINS, {}, EMPTY_MAP).zone, null);
  assert.equal(resolvePlace('Beans', TINS, undefined, undefined).zone, null);
  const id = customId('Back wall');
  assert.equal(id, 'x:back-wall');
  const p = resolvePlace('Beans', TINS, { Beans: makeTag({ zone: id, zoneLabel: 'Back wall', side: 'left' }) }, EMPTY_MAP);
  assert.equal(p.zone.label, 'Back wall'); assert.equal(p.source, 'you');
});

test('a tag pointing at a zone that has left the map still resolves', () => {
  const p = resolvePlace('Beans', TINS, { Beans: { zone: 'gone', zoneLabel: 'Old aisle' } }, sample);
  assert.equal(p.zone.label, 'Old aisle');
});

test('text for the chip and the group header', () => {
  const a7 = sample.zones.find((z) => z.id === 'a7');
  assert.equal(placeText({ zone: a7, side: 'left', shelf: 'middle' }), 'Aisle 7 · left · middle');
  assert.equal(placeText({ zone: a7, side: '', shelf: '' }), 'Aisle 7');
  assert.equal(placeText({ zone: null }), '');
  assert.equal(zoneHeading(a7), 'Aisle 7 · Tins, Pasta, Rice');
  assert.equal(zoneHeading(null), 'Not placed yet');
});

// A trip: ticked in this order, each pick a minute apart.
const trip = (date, store, names) => ({ store, date, picks: names.map(([product, zone], i) => ({ product, zone, t: Date.parse(date) + i * 60000 })) });

test('walk-order learning: median position per zone across trips', () => {
  const t1 = trip('2026-10-01', 'morrisons', [['carrots', 'fv'], ['beans', 'a7'], ['flour', 'a9'], ['milk', 'dairy']]);
  const t2 = trip('2026-10-08', 'morrisons', [['carrots', 'fv'], ['beans', 'a7'], ['flour', 'a9'], ['milk', 'dairy']]);
  const t3 = trip('2026-10-15', 'morrisons', [['beans', 'a7'], ['carrots', 'fv'], ['milk', 'dairy'], ['flour', 'a9']]); // an odd one
  const L = learnOrder([t1, t2, t3]);
  assert.equal(L.trips, 3);
  assert.equal(L.zones.fv, 0);        // median of 0, 0, 1/3
  assert.equal(L.zones.dairy, 1);     // median of 1, 1, 2/3
  assert.ok(L.zones.a7 < L.zones.a9); // aisle 7 before aisle 9, despite the odd trip
  assert.ok(L.products.carrots <= L.products.beans);
});

test('learning ignores other stores and one-item trips', () => {
  const L = learnOrder([trip('2026-10-01', 'lidl', [['a', 'z'], ['b', 'y']]), trip('2026-10-02', 'morrisons', [['a', 'z']])]);
  assert.equal(L.trips, 0);
  assert.deepEqual(L.zones, {});
});

test('ranking: walkOrder until 3 trips, then what you actually did', () => {
  const map = sample;
  const noTrips = zoneRanker(map, learnOrder([]));
  const z = (id) => map.zones.find((x) => x.id === id);
  assert.ok(noTrips(z('fv')) < noTrips(z('a7')) && noTrips(z('a7')) < noTrips(z('a9')) && noTrips(z('a9')) < noTrips(z('dairy')));
  assert.equal(noTrips(null), Infinity);

  // You actually walk dairy first, then fv, a7, a9 (opposite of the map).
  const walk = (d) => trip(d, 'morrisons', [['milk', 'dairy'], ['carrots', 'fv'], ['beans', 'a7'], ['flour', 'a9']]);
  const two = zoneRanker(map, learnOrder([walk('2026-10-01'), walk('2026-10-08')]));
  assert.ok(two(z('fv')) < two(z('dairy')), 'two trips: still the hand-set order');
  const three = zoneRanker(map, learnOrder([walk('2026-10-01'), walk('2026-10-08'), walk('2026-10-15')]));
  assert.ok(three(z('dairy')) < three(z('fv')), 'three trips: your real order wins');
  assert.ok(three(z('fv')) < three(z('a7')) && three(z('a7')) < three(z('a9')));
});

test('ranking: with no walkOrder at all, learned order is used straight away; unordered zones sit between', () => {
  const map = { zones: [{ id: 'p', label: 'P' }, { id: 'q', label: 'Q' }, { id: 'r', label: 'R' }] };
  const L = learnOrder([trip('2026-10-01', 'morrisons', [['a', 'q'], ['b', 'p']])]);
  const rank = zoneRanker(map, L);
  assert.ok(rank(map.zones[1]) < rank(map.zones[0])); // q before p, seen once
  assert.equal(rank(map.zones[2]), 1.5);              // never seen, no walkOrder
});

test('grouping: zones in walk order, unplaced last, items alphabetical without history', () => {
  const rows = [
    { n: 'Cheddar', cat: ['Fresh Foods', 'Cheese'] },
    { n: 'Pet food', cat: ['Pet Shop', 'Dog & Puppy'] },
    { n: 'Tinned tomatoes', cat: TINS },
    { n: 'Baked beans', cat: TINS },
    { n: 'Onions', cat: ['Fresh Fruit & Veg', 'Vegetables'] },
  ];
  const g = groupByZone(rows, (r) => resolvePlace(r.n, r.cat, {}, sample), (r) => r.n, sample, null);
  assert.deepEqual(g.map((x) => x.zone?.id ?? null), ['fv', 'a7', 'dairy', null]);
  assert.deepEqual(g[1].rows.map((r) => r.n), ['Baked beans', 'Tinned tomatoes']);
});

test('grouping: tagging an item moves it to the new zone', () => {
  const rows = [{ n: 'Baked beans', cat: TINS }];
  const before = groupByZone(rows, (r) => resolvePlace(r.n, r.cat, {}, sample), (r) => r.n, sample, null);
  assert.equal(before[0].zone.id, 'a7');
  const places = { 'Baked beans': makeTag({ zone: 'dairy', side: 'right', shelf: 'top' }) };
  const after = groupByZone(rows, (r) => resolvePlace(r.n, r.cat, places, sample), (r) => r.n, sample, null);
  assert.equal(after[0].zone.id, 'dairy');
});

test('grouping: with an empty map every item is under Not placed yet', () => {
  const g = groupByZone([{ n: 'x', cat: TINS }], (r) => resolvePlace(r.n, r.cat, {}, EMPTY_MAP), (r) => r.n, EMPTY_MAP, null);
  assert.equal(g.length, 1); assert.equal(g[0].zone, null);
});

test('grouping: within a zone, learned product order beats alphabetical', () => {
  const walk = (d) => trip(d, 'morrisons', [['Tinned tomatoes', 'a7'], ['Baked beans', 'a7'], ['Flour', 'a9']]);
  const L = learnOrder([walk('2026-10-01'), walk('2026-10-08'), walk('2026-10-15')]);
  const rows = [{ n: 'Baked beans', cat: TINS }, { n: 'Tinned tomatoes', cat: TINS }];
  const g = groupByZone(rows, (r) => resolvePlace(r.n, r.cat, {}, sample), (r) => r.n, sample, L);
  assert.deepEqual(g[0].rows.map((r) => r.n), ['Tinned tomatoes', 'Baked beans']);
});

test('trips: ticks append to today’s trip, unticks remove, last 20 kept', () => {
  const day = (d) => Date.parse(`2026-10-${String(d).padStart(2, '0')}T12:00:00`);
  let trips = [];
  trips = recordPick(trips, { store: 'morrisons', product: 'a', zone: 'a7', t: day(1) }, true);
  trips = recordPick(trips, { store: 'morrisons', product: 'b', zone: null, t: day(1) + 1000 }, true);
  assert.equal(trips.length, 1); assert.equal(trips[0].picks.length, 2); assert.equal(trips[0].picks[1].zone, null);
  // a different shop the same day is its own trip
  trips = recordPick(trips, { store: 'lidl', product: 'c', zone: null, t: day(1) }, true);
  assert.equal(trips.length, 2);
  // untick removes only that pick; ticking twice doesn't duplicate
  trips = recordPick(trips, { store: 'morrisons', product: 'a', zone: 'a7', t: day(1) }, false);
  assert.deepEqual(trips.find((x) => x.store === 'morrisons').picks.map((p) => p.product), ['b']);
  trips = recordPick(trips, { store: 'morrisons', product: 'b', zone: null, t: day(1) + 2000 }, true);
  assert.equal(trips.find((x) => x.store === 'morrisons').picks.length, 1);
  // untick on an empty list is a no-op, and doesn't mutate its input
  const frozen = [];
  assert.deepEqual(recordPick(frozen, { store: 'morrisons', product: 'a', zone: null, t: day(2) }, false), []);
  // 25 days of one pick each: only the last 20 trips survive
  let many = [];
  for (let d = 1; d <= 25; d++) many = recordPick(many, { store: 'morrisons', product: 'a', zone: 'a7', t: day(d) }, true);
  assert.equal(many.length, 20);
  assert.equal(many[0].date, '2026-10-06');
});
