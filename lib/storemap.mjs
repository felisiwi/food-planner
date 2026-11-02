// Where things are in the shop, and the order you walk it. Pure functions (no React, no browser),
// so they can be tested in plain Node. The app glues them to the Shop list.
//
// Precedence for "where is this product?":  your own tag  >  the store map's product entry
//                                           >  the category -> zone mapping  >  nothing.

export const EMPTY_MAP = { store: '', updated: '', zones: [], products: {}, needsCheck: [] };

const norm = (s) => String(s ?? '').trim().toLowerCase();

// A custom aisle typed in through "Other…" has no entry in the map; its id starts with this.
export const CUSTOM_PREFIX = 'x:';
export const customId = (label) => CUSTOM_PREFIX + norm(label).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Which zone does a category path like ["Food Cupboard", "Tins, Cans & Packets"] belong to?
// Most specific first: the whole path, then the second level, then the top level.
export function zoneForCategory(category, zones) {
  if (!category?.length || !zones?.length) return null;
  const tries = [category.join(' > '), category[1], category[0]].filter(Boolean).map(norm);
  for (const t of tries) {
    const z = zones.find((z) => (z.categories || []).some((c) => norm(c) === t));
    if (z) return z;
  }
  return null;
}

// Resolve one product to a place. `places` is your own tags, `map` the store map.
// Returns { zone, side, shelf, note, source } where zone is { id, label, signs, walkOrder } or null.
export function resolvePlace(product, category, places, map) {
  const zones = map?.zones || [];
  const find = (id) => zones.find((z) => z.id === id);
  const mine = places?.[product];
  if (mine?.zone) {
    // A tag pointing at a zone that has since left the map still shows, using the label saved with it.
    const z = find(mine.zone) || { id: mine.zone, label: mine.zoneLabel || mine.zone, signs: [], walkOrder: null };
    return { zone: z, side: mine.side || '', shelf: mine.shelf || '', note: mine.note || '', source: 'you' };
  }
  const entry = map?.products?.[product];
  if (entry?.zone && find(entry.zone)) {
    return { zone: find(entry.zone), side: entry.side || '', shelf: entry.shelf || '', note: entry.note || '', source: 'map' };
  }
  const z = zoneForCategory(category, zones);
  if (z) return { zone: z, side: '', shelf: '', note: '', source: 'category' };
  return { zone: null, side: '', shelf: '', note: '', source: null };
}

// "Aisle 7 · left · middle", or "" when nothing is known.
export function placeText(place) {
  if (!place?.zone) return '';
  return [place.zone.label, place.side, place.shelf].filter(Boolean).join(' · ');
}

// "Aisle 7 · Tins, Pasta, Rice" for the group header.
export function zoneHeading(zone) {
  if (!zone) return 'Not placed yet';
  const signs = (zone.signs || []).join(', ');
  return signs ? `${zone.label} · ${signs}` : zone.label;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---- Walk-order learning ----
// Each trip is { store, date, picks: [{ product, zone, t }] }. Within a trip a pick's position is
// its rank in time order, scaled to 0 (first thing picked) .. 1 (last), so long and short trips compare.
// A zone's position in one trip is the median of its picks' positions; across trips it's the median again.
export function learnOrder(trips, store = 'morrisons') {
  const use = (trips || []).filter((t) => t.store === store && (t.picks || []).length >= 2);
  const zoneSeen = {};
  const prodSeen = {};
  for (const trip of use) {
    const picks = [...trip.picks].sort((a, b) => a.t - b.t);
    const pos = (i) => i / (picks.length - 1);
    const perZone = {};
    picks.forEach((p, i) => {
      (prodSeen[p.product] ||= []).push(pos(i));
      if (p.zone) (perZone[p.zone] ||= []).push(pos(i));
    });
    for (const [z, ps] of Object.entries(perZone)) (zoneSeen[z] ||= []).push(median(ps));
  }
  const fold = (seen) => Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, median(v)]));
  return { trips: use.length, zones: fold(zoneSeen), products: fold(prodSeen) };
}

// A comparable number for each zone, 0 = shop entrance end .. 1 = tills end; Infinity = unknown.
// The hand-set walkOrder is the default; once there are `minTrips` trips, what you actually did wins
// for every zone you've been to, and walkOrder only covers zones you haven't ticked anything in.
// Both are put on the same 0..1 scale (walkOrder is spread over the map's own min..max).
export function zoneRanker(map, learned, minTrips = 3) {
  const orders = (map?.zones || []).map((z) => z.walkOrder).filter((n) => typeof n === 'number');
  const lo = Math.min(...orders), hi = Math.max(...orders);
  const fromMap = (z) => (typeof z?.walkOrder !== 'number' ? null : hi === lo ? 0 : (z.walkOrder - lo) / (hi - lo));
  const trusted = learned && learned.trips >= minTrips;
  return (zone) => {
    if (!zone) return Infinity;
    const l = learned?.zones?.[zone.id];
    const m = fromMap(zone);
    if (trusted && l != null) return l;
    if (m != null) return m;
    if (l != null) return l; // no hand-set order: use what we've seen, even from fewer trips
    return 1.5; // placed but no order known: after the ordered zones, before "Not placed yet"
  };
}

// Group Shop rows into zones in walking order. `rows` are anything; `placeOf(row)` gives its place,
// `nameOf(row)` its product name. Returns [{ zone, rows }], with the unplaced group last.
export function groupByZone(rows, placeOf, nameOf, map, learned) {
  const rank = zoneRanker(map, learned);
  const groups = new Map();
  for (const r of rows) {
    const z = placeOf(r).zone;
    const id = z ? z.id : '';
    if (!groups.has(id)) groups.set(id, { zone: z, rows: [] });
    groups.get(id).rows.push(r);
  }
  const prodPos = (r) => learned?.products?.[nameOf(r)] ?? Infinity;
  return [...groups.values()]
    .map((g) => ({ ...g, rows: [...g.rows].sort((a, b) => prodPos(a) - prodPos(b) || nameOf(a).localeCompare(nameOf(b))) }))
    .sort((a, b) => rank(a.zone) - rank(b.zone) || (a.zone?.label || '').localeCompare(b.zone?.label || ''));
}

// ---- Trips ----
const dayOf = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const MAX_TRIPS = 20;

// Add (done = true) or remove (done = false) one pick on today's trip for this store.
// Ticking and unticking the same item leaves no trace, so a mis-tap doesn't bend the learned order.
export function recordPick(trips, { store, product, zone, t }, done, keep = MAX_TRIPS) {
  const date = dayOf(t);
  const list = (trips || []).map((x) => ({ ...x, picks: [...x.picks] }));
  let trip = list.find((x) => x.store === store && x.date === date);
  if (!trip) {
    if (!done) return trips || [];
    trip = { store, date, picks: [] };
    list.push(trip);
  }
  trip.picks = trip.picks.filter((p) => p.product !== product);
  if (done) trip.picks.push({ product, zone: zone || null, t });
  return list.filter((x) => x.picks.length).slice(-keep);
}

// Your tag, ready to save.
export function makeTag({ zone, zoneLabel, side, shelf, note }, at = Date.now()) {
  return { zone, ...(zoneLabel ? { zoneLabel } : {}), side: side || '', shelf: shelf || '', note: (note || '').trim(), at };
}
