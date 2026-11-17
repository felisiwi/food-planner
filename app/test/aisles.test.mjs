// Run: npm --prefix app test
// Aisle lookups: name matching, pop-up parsing, placing into the store map, cache freshness, walking order (lib/aisles.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SOURCE, normName, rowMatches, sameProduct, parseSheet, zoneFromLocation, sideFromDescription, posFromDescription,
  applyPlace, isFresh, planLookups, parseAisleList, walkingOrder, recordNotFound,
} from '../../lib/aisles.mjs';
import { queriesFor } from '../../lib/phone.mjs';
import { EMPTY_MAP, resolvePlace, placeText, groupByZone, learnOrder } from '../../lib/storemap.mjs';

const real = JSON.parse(readFileSync(new URL('../../store-map/stamford-hill.json', import.meta.url), 'utf8'));
const DESC = 'With your back to the checkouts they can be found near the start of aisle 2, on the right-hand side.';
const found = (location, description = DESC) => ({ location, description, checked: '2026-11-12' });

test('website and app spellings of the same product compare equal', () => {
  assert.equal(normName('Morrisons Chickpeas In Water (400g)'), normName('Morrisons Chickpeas In Water 400g'));
  assert.equal(normName('Indus Minced Paste Ginger &amp; Garlic 210g'), normName('indus minced paste ginger & garlic 210g'));
});

test('result rows are only candidates; the pop-up title decides (a different Kallo product must not pass)', () => {
  assert.ok(rowMatches('Morrisons Chickpeas In Water 400g Unbeatable 37p £1.54 per kg', 'Morrisons Chickpeas In Water 400g'));
  assert.ok(rowMatches('Kallo Organic Vegetable Broth 500ml £3 £6 per litre', 'Kallo')); // a candidate...
  assert.ok(!sameProduct('Kallo Organic Vegetable Broth 500ml', 'Kallo Very Low Salt Vegetable Stock Cubes')); // ...but not the product
  assert.ok(!rowMatches('Onions 3 Pack 95p', 'Red Onions'));
  assert.ok(rowMatches('Onions 95p per kg', 'Onions'));
  assert.ok(!sameProduct('Onions 1kg', 'Onions'));
});

test('pop-up text: title first, location and sentence last', () => {
  const s = parseSheet(['Morrisons Chickpeas In Water 400g', 'Unbeatable', '37p', '£1.54 per kg', 'Aisle 2', DESC]);
  assert.deepEqual(s, { title: 'Morrisons Chickpeas In Water 400g', location: 'Aisle 2', description: DESC });
  assert.equal(parseSheet(['only', 'two']), null);
  assert.equal(parseSheet(['a', '£1', 'b', 'not a place']), null);
});

test('zones: numbered aisles get a labelled provisional order; other places stay unordered', () => {
  assert.deepEqual(zoneFromLocation('Aisle 16'), { id: 'a16', label: 'Aisle 16', walkOrder: 16, walkOrderSource: 'assumed: numbered aisles in number order' });
  assert.deepEqual(zoneFromLocation('Fresh Produce Section'), { id: 'fresh-produce-section', label: 'Fresh Produce Section', walkOrder: null });
  assert.equal(zoneFromLocation('End of Aisle (Facing Checkouts)').id, 'end-of-aisle-facing-checkouts');
});

test('side comes from the sentence', () => {
  assert.equal(sideFromDescription(DESC), 'right');
  assert.equal(sideFromDescription('... on the left-hand side.'), 'left');
  assert.equal(sideFromDescription('They can be found by the Potatoes, in the fresh produce section.'), '');
});

test('placing writes every name the product goes by, adds the zone once, and leaves the input map alone', () => {
  const before = structuredClone(EMPTY_MAP);
  const names = ['Morrisons Chickpeas In Water 400g', 'Morrisons Chickpeas In Water (400g)'];
  const m1 = applyPlace(EMPTY_MAP, names, found('Aisle 2'));
  assert.deepEqual(EMPTY_MAP, before);
  assert.equal(m1.zones.length, 1);
  assert.equal(m1.products[names[1]].zone, 'a2');
  assert.equal(m1.products[names[1]].side, 'right');
  assert.equal(m1.products[names[1]].source, SOURCE);
  const m2 = applyPlace(m1, ['Morrisons Chopped Tomatoes 400g'], found('Aisle 2'));
  assert.equal(m2.zones.length, 1); // same aisle, no duplicate zone
  assert.equal(resolvePlace('Morrisons Chickpeas In Water (400g)', null, {}, m2).zone.label, 'Aisle 2');
});

test('a hand-set place is never overwritten, and is always "known"', () => {
  const mine = { ...EMPTY_MAP, zones: [{ id: 'a9', label: 'Aisle 9', walkOrder: 9, signs: [], categories: [] }], products: { Rice: { zone: 'a9', side: 'left', shelf: 'top', note: 'mine' } } };
  const m = applyPlace(mine, ['Rice'], found('Aisle 2'));
  assert.deepEqual(m.products.Rice, mine.products.Rice);
  const { cached, todo } = planLookups([{ names: ['Rice'] }], mine, '2030-01-01', { refresh: true });
  assert.equal(cached.length, 1);
  assert.equal(todo.length, 0);
});

test('freshness: recent answers are reused, old ones and unknowns go to the phone, --refresh redoes ours', () => {
  const m = applyPlace(EMPTY_MAP, ['A'], found('Aisle 2')); // checked 2026-11-12
  assert.ok(isFresh(m.products.A, '2026-12-10', 28));
  assert.ok(!isFresh(m.products.A, '2026-12-11', 28));
  const items = [{ names: ['A'] }, { names: ['B'] }];
  let p = planLookups(items, m, '2026-11-20');
  assert.deepEqual([p.cached.length, p.todo.length], [1, 1]);
  p = planLookups(items, m, '2026-11-20', { refresh: true });
  assert.deepEqual([p.cached.length, p.todo.length], [0, 2]);
  p = planLookups(items, m, '2027-03-01');
  assert.equal(p.todo.length, 2);
});

test('list file: app name first, website aliases after, comments ignored', () => {
  const items = parseAisleList('# tonight\nMorrisons Chickpeas In Water 400g | Morrisons Chickpeas In Water (400g)\n\nOnions   # loose\n');
  assert.deepEqual(items, [{ names: ['Morrisons Chickpeas In Water 400g', 'Morrisons Chickpeas In Water (400g)'] }, { names: ['Onions'] }]);
});

test('walking order: Aisle 2 before Aisle 16 (not alphabetical), unordered zones after, unplaced last', () => {
  let m = EMPTY_MAP;
  m = applyPlace(m, ['Spinach'], found('Aisle 16'));
  m = applyPlace(m, ['Carrots'], found('Fresh Produce Section', 'They can be found by the Potatoes, in the fresh produce section.'));
  m = applyPlace(m, ['Chickpeas'], found('Aisle 2'));
  const groups = walkingOrder([{ names: ['Spinach'] }, { names: ['Carrots'] }, { names: ['Chickpeas'] }, { names: ['Mystery'] }], m);
  assert.deepEqual(groups.map((g) => g.zone?.label ?? 'unplaced'), ['Aisle 2', 'Aisle 16', 'Fresh Produce Section', 'unplaced']);
});

test('what gets typed into the app: no special characters, and a second try without the size', () => {
  assert.deepEqual(queriesFor('Indus Minced Paste Ginger & Garlic 210g'), ['Indus Minced Paste Ginger Garlic 210g', 'Indus Minced Paste Ginger Garlic']);
  assert.deepEqual(queriesFor('Onions'), ['Onions']);
});

test('position along the aisle: read from the sentence, kept in the map, shown in the chip', () => {
  assert.equal(posFromDescription('... near the start of aisle 2, on the right-hand side.'), 0);
  assert.equal(posFromDescription('... halfway down aisle 1, on the right-hand side.'), 0.5);
  assert.equal(posFromDescription('... near the end of aisle 1, on the right-hand side.'), 1);
  assert.equal(posFromDescription('They can be found by the Potatoes, in the fresh produce section.'), null);
  const m = applyPlace(EMPTY_MAP, ['Rice'], found('Aisle 2', '... halfway down aisle 2, on the left-hand side.'));
  assert.equal(m.products.Rice.pos, 0.5);
  assert.equal(placeText(resolvePlace('Rice', null, {}, m)), 'Aisle 2 · left · halfway');
  const noPos = applyPlace(EMPTY_MAP, ['Carrots'], found('Fresh Produce Section', 'They can be found by the Potatoes.'));
  assert.ok(!('pos' in noPos.products.Carrots)); // unknown stays unknown, not 0
  assert.equal(placeText(resolvePlace('Carrots', null, {}, noPos)), 'Fresh Produce Section');
});

test('inside one aisle the list runs start to end; what you really did beats it; unknown goes last', () => {
  let m = EMPTY_MAP;
  const at = (name, where) => { m = applyPlace(m, [name], found('Aisle 1', `... ${where} aisle 1, on the right-hand side.`)); };
  at('Zeta paste', 'near the start of'); at('Alpha curry', 'near the end of'); at('Mid tin', 'halfway down');
  m = applyPlace(m, ['Beta unknown'], found('Aisle 1', 'They can be found in aisle 1.'));
  const rows = ['Alpha curry', 'Beta unknown', 'Mid tin', 'Zeta paste'];
  const order = (learned) => groupByZone(rows, (r) => resolvePlace(r, null, {}, m), (r) => r, m, learned)[0].rows;
  assert.deepEqual(order(null), ['Zeta paste', 'Mid tin', 'Alpha curry', 'Beta unknown']);
  // three trips where you picked Alpha before Zeta: your own order wins for those two
  const trips = [1, 2, 3].map((d) => ({ store: 'morrisons', date: `2026-11-0${d}`, picks: [{ product: 'Alpha curry', zone: 'a1', t: 1 }, { product: 'Zeta paste', zone: 'a1', t: 2 }] }));
  const learned = learnOrder(trips);
  const got = order(learned);
  assert.ok(got.indexOf('Alpha curry') < got.indexOf('Zeta paste'));
});

test('the shipped map is valid: right shape, and every product points at a zone that exists', () => {
  assert.ok(Array.isArray(real.zones));
  assert.equal(typeof real.products, 'object');
  const ids = new Set(real.zones.map((z) => z.id));
  assert.equal(ids.size, real.zones.length, 'zone ids are unique');
  for (const [name, e] of Object.entries(real.products)) assert.ok(ids.has(e.zone), `${name} -> unknown zone ${e.zone}`);
});

test('a product searched for and not found is remembered, so the phone is not asked again', () => {
  const rows = ['Morrisons Yellow Split Peas 500g £1.30 £2.60 per kg'];
  const m = recordNotFound(EMPTY_MAP, 'Morrisons Wholefoods Yellow Split Peas', rows, '2026-11-17');
  const items = [{ names: ['Morrisons Wholefoods Yellow Split Peas'] }, { names: ['Other'] }];
  let p = planLookups(items, m, '2026-11-18');
  assert.deepEqual([p.cached.length, p.searched.length, p.todo.length], [0, 1, 1]);
  assert.deepEqual(m.notFound['Morrisons Wholefoods Yellow Split Peas'].rows, rows);
  p = planLookups(items, m, '2026-11-18', { retryNotFound: true });
  assert.deepEqual([p.searched.length, p.todo.length], [0, 2]); // --retry-not-found
  p = planLookups(items, m, '2026-11-18', { refresh: true });
  assert.equal(p.searched.length, 0); // --refresh
  p = planLookups(items, m, '2026-12-30');
  assert.equal(p.searched.length, 0); // old misses are searched again
});

test('once a product is found under another name, an old "not found" no longer matters', () => {
  let m = recordNotFound(EMPTY_MAP, 'Wholefoods Peas', [], '2026-11-17');
  m = applyPlace(m, ['Wholefoods Peas', 'Peas 500g'], found('Aisle 2'));
  const p = planLookups([{ names: ['Wholefoods Peas', 'Peas 500g'] }], m, '2026-11-18');
  assert.deepEqual([p.cached.length, p.searched.length, p.todo.length], [1, 0, 0]);
});
