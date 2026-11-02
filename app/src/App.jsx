import { useEffect, useMemo, useRef, useState } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { Checkbox } from '@base-ui/react/checkbox';
import { Switch } from '@base-ui/react/switch';
import { Drawer } from '@base-ui/react/drawer';
import { Dialog } from '@base-ui/react/dialog';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Toggle } from '@base-ui/react/toggle';
import { Toast } from '@base-ui/react/toast';
import { NumberField } from '@base-ui/react/number-field';
import { DATA, morrisonsFor, lidlFor, aldiFor, aldiNoPrice, gbp, perUnit, unitText, orderOptions, choosePack, sizeText, needAmount, probablyHave, shareFor, usedCost, dishesFor, withCount } from './data.js';
import { useCapability, useDoc, ingredientsFor, sampleErrorText } from './claude.js';
import { EMPTY_MAP, resolvePlace, placeText, zoneHeading, learnOrder, groupByZone, recordPick, makeTag, customId, CUSTOM_PREFIX } from '../../lib/storemap.mjs';

const isWeb = () => !!window.__FP_WEB__;

const STORES = [
  { id: 'morrisons', label: 'Morrisons', place: 'Stamford Hill' },
  { id: 'lidl', label: 'Lidl', place: 'Amhurst Park' },
  { id: 'aldi', label: 'Aldi', place: 'online prices' },
];
const label = (id) => STORES.find((s) => s.id === id)?.label || id;
const key = (s) => s.trim().toLowerCase();
const needText = (it) => {
  if (!it.amount) return '';
  const n = +Number(it.amount).toFixed(2);
  if (['g', 'kg', 'ml', 'l'].includes(it.unit)) return `${n}${it.unit}`;
  if (it.unit === 'tin' || it.unit === 'pack') return `${n} ${it.unit}${n === 1 ? '' : 's'}`;
  return `${n} ${it.unit || ''}`.trim();
};

function Check() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m3 8.5 3.2 3L13 4.5" />
    </svg>
  );
}

export default function App() {
  const db = useCapability('db');
  const sample = useCapability('sample');
  return (
    <Toast.Provider>
      <Planner db={db} sample={sample} />
      <Toast.Portal>
        <Toast.Viewport className="toasts">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((t) => (
    <Toast.Root key={t.id} toast={t} className="toast">
      <Toast.Content className="toast-content">
        <Toast.Title className="toast-title" />
        <Toast.Description className="toast-desc" />
      </Toast.Content>
    </Toast.Root>
  ));
}

function Planner({ db, sample }) {
  const toast = Toast.useToastManager();
  const dbReady = db !== undefined;
  const [plan, setPlan] = useDoc(db || null, 'plan', { meals: '', items: null });
  const [pantry, setPantry] = useDoc(db || null, 'pantry', []);
  const [ticks, setTicks] = useDoc(db || null, 'ticks', {});
  const [picks, setPicks] = useDoc(db || null, 'picks', {});
  const [mine, setMine] = useDoc(db || null, 'myprices', {});
  const [places, setPlaces] = useDoc(db || null, 'places', {}); // your aisle tags: { [product]: { zone, side, shelf, note, at } }
  const [trips, setTrips] = useDoc(db || null, 'trips', []); // the order you ticked things off, last 20 shop trips
  const [queue, setQueue] = useDoc(db || null, 'queue', []);
  // Packs you set with − / + in the shop list, per shop and item, tied to the product picked.
  const [qty, setQty] = useDoc(db || null, 'qty', {});
  const [shopsOn, setShopsOn] = useDoc(db || null, 'shops', STORES.map((s) => s.id));
  const active = STORES.filter((s) => shopsOn.includes(s.id));
  const [tab, setTab] = useState('plan');
  const [split, setSplit] = useState(true);
  // Old saves stored a position in a list whose order depended on this (now removed) switch.
  const legacyUnit = useMemo(() => { try { return localStorage.getItem('fp-byunit') === '1'; } catch { return false; } }, []);

  const items = plan.items || DATA.example || [];
  const isExample = !plan.items;
  const pantrySet = useMemo(() => new Set(pantry.map(key)), [pantry]);
  const needed = items.filter((it) => !it.skip && !pantrySet.has(key(it.item)));

  // Where things are in Morrisons: the map baked into the data (empty until the aisle photos are read),
  // your own tags on top, and the walking order learned from your trips.
  const storeMap = DATA.storeMap || EMPTY_MAP;
  const learned = useMemo(() => learnOrder(trips, 'morrisons'), [trips]);
  const nameAtMorrisons = (r) => r.chosen.morrisons?.name ?? r.it.item;
  const placeOf = (r) => resolvePlace(nameAtMorrisons(r), r.chosen.morrisons?.category, places, storeMap);
  // Zones for the picker: the map's, plus any you typed in yourself under "Other…".
  const pickerZones = useMemo(() => {
    const custom = new Map();
    for (const t of Object.values(places || {})) if (t?.zone?.startsWith(CUSTOM_PREFIX) && !custom.has(t.zone)) custom.set(t.zone, { id: t.zone, label: t.zoneLabel || t.zone, signs: [], walkOrder: null });
    return [...(storeMap.zones || []), ...custom.values()];
  }, [places, storeMap]);

  // Options per store for each needed item; your own prices come first.
  const rows = useMemo(
    () =>
      needed.map((it) => {
        const k = key(it.item);
        const opts = {
          morrisons: morrisonsFor(k),
          lidl: [
            ...(mine.lidl?.[k] ? [{ name: it.item, price: mine.lidl[k].price, date: mine.lidl[k].date, source: 'you', match: true, category: [] }] : []),
            ...lidlFor(k),
          ],
          aldi: aldiFor(k),
        };
        // sel = the pack(s) picked at each shop: which product, how many, what it costs, whether it's oversized.
        // base: the automatic pick, used to decide which shop wins. sel: with any − / + changes,
        // used for what you pay, so adding a pack doesn't move an item to another shop's list.
        const base = Object.fromEntries(STORES.map((s) => [s.id, choosePack(opts[s.id], it, picks[s.id]?.[k], legacyUnit)]));
        const sel = Object.fromEntries(STORES.map((s) => {
          const q = qty[s.id]?.[k];
          return [s.id, q && base[s.id] && q.name === base[s.id].opt.name ? withCount(base[s.id], q.n) : base[s.id]];
        }));
        // The three labelled alternatives shown in the options sheet and the "bigger pack" suggestion.
        const alts = Object.fromEntries(STORES.map((s) => [s.id, opts[s.id].length ? {
          best: choosePack(opts[s.id], it, { mode: 'similar' }),
          unit: choosePack(opts[s.id], it, { mode: 'unit' }),
          pack: choosePack(opts[s.id], it, { mode: 'pack' }),
        } : null]));
        const chosen = Object.fromEntries(STORES.map((s) => [s.id, sel[s.id]?.opt ?? null]));
        const cost = Object.fromEntries(STORES.map((s) => [s.id, sel[s.id] ? sel[s.id].cost : null]));
        const unit = Object.fromEntries(STORES.map((s) => [s.id, perUnit(chosen[s.id])]));
        // Compare per kg/l when both shops give the same unit, otherwise per pack.
        // An oversized pick is judged by what you'd actually pay, so a cheap-per-kg giant bag doesn't win the split.
        // With more than two shops: per kg/l only when every shop that has it gives the same unit.
        const baseCost = Object.fromEntries(STORES.map((s) => [s.id, base[s.id] ? base[s.id].cost : null]));
        const priced = active.filter((s) => baseCost[s.id] != null);
        const oversized = priced.some((s) => base[s.id]?.big);
        const units = priced.map((s) => unit[s.id]?.u);
        const sameUnit = !oversized && priced.length > 1 && units.every((u) => u && u === units[0]);
        const value = (id) => (sameUnit ? unit[id].v : baseCost[id]);
        const known = [...priced].sort((a, b) => value(a.id) - value(b.id));
        return { it, k, opts, sel, alts, chosen, cost, unit, have: probablyHave(it), basis: sameUnit ? 'per ' + units[0] : oversized ? 'for what you’d pay' : 'per pack', value, best: known[0]?.id || null };
      }),
    [needed, mine, picks, legacyUnit, shopsOn, qty],
  );

  // Ingredients with no Morrisons price yet go on the laptop's to-do list.
  useEffect(() => {
    if (!db || isExample) return;
    const missing = rows.filter((r) => !r.opts.morrisons.length).map((r) => r.k);
    const next = [...new Set([...queue, ...missing])];
    if (next.length !== queue.length) setQueue(next);
  }, [db, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save a pick for one item at one shop ('both' = both shops, used by the Compare toggle).
  const setPick = (sid, k, value) => {
    const ids = sid === 'both' ? active.map((s) => s.id) : [sid];
    setPicks({ ...picks, ...Object.fromEntries(ids.map((id) => [id, { ...(picks[id] || {}), [k]: value }])) });
  };

  // Ticking stores the time (older saves just have `true`), and adds the item to today's trip so the
  // walking order can be learned. Unticking takes it off again.
  const tick = (sid, r, v) => {
    const t = Date.now();
    setTicks({ ...ticks, [sid]: { ...(ticks[sid] || {}), [r.k]: v ? t : false } });
    setTrips(recordPick(trips, { store: sid, product: sid === 'morrisons' ? nameAtMorrisons(r) : r.chosen[sid]?.name ?? r.it.item, zone: sid === 'morrisons' ? placeOf(r).zone?.id : null, t }, v));
  };
  const saveTag = (product, tag) => {
    const next = { ...places };
    if (tag) next[product] = tag; else delete next[product];
    setPlaces(next);
  };

  const totals = Object.fromEntries(STORES.map((s) => [s.id, rows.reduce((a, r) => a + (r.cost[s.id] ?? 0), 0)]));
  const counts = Object.fromEntries(STORES.map((s) => [s.id, rows.filter((r) => r.cost[s.id] != null).length]));
  const splitTotal = rows.reduce((a, r) => a + (r.best ? r.cost[r.best] : 0), 0);
  // Like-for-like: only the items both Morrisons and the other shop have, so a shop
  // with fewer items listed doesn't look cheaper just for being incomplete.
  const vsMorrisons = active.filter((s) => s.id !== 'morrisons').map((s) => {
    const same = rows.filter((r) => r.cost.morrisons != null && r.cost[s.id] != null);
    const m = same.reduce((a, r) => a + r.cost.morrisons, 0);
    const o = same.reduce((a, r) => a + r.cost[s.id], 0);
    return { s, n: same.length, m, o, diff: m - o, pct: m > 0 ? Math.round(((m - o) / m) * 100) : 0 };
  }).filter((c) => c.n > 0);
  // Cost per portion of each planned meal: what the meal uses (not whole packs),
  // cupboard items included, at Morrisons and with the cheapest split.
  const dishes = isExample ? DATA.exampleDishes || dishesFor({}, items) : dishesFor(plan, items);
  const dishCosts = useMemo(() => {
    const byKey = new Map(rows.map((r) => [r.k, r]));
    return dishes.map((d) => {
      let m = 0, split = 0, approx = false;
      const missing = [];
      for (const it of items) {
        if (it.skip) continue;
        const inDish = dishes.length === 1 || (it.meals || []).map((x) => x.toLowerCase()).includes(d.name);
        if (!inDish) continue;
        const qty = shareFor(it, d.name, dishes.length);
        const k = key(it.item);
        const r = byKey.get(k);
        const mSel = r ? r.sel.morrisons : choosePack(morrisonsFor(k), it, picks.morrisons?.[k], legacyUnit);
        const mc = qty ? usedCost(mSel?.opt, mSel, it, qty) : null;
        if (!mc) { missing.push(it.item); continue; }
        m += mc.cost;
        approx ||= mc.approx;
        const bSel = r?.best ? r.sel[r.best] : mSel;
        split += (usedCost(bSel?.opt, bSel, it, qty) || mc).cost;
      }
      const servings = d.servings || 2;
      return { ...d, servings, assumed: !d.servings, total: m, split, missing, approx };
    });
  }, [rows, items, plan.dishes, plan.meals, picks, legacyUnit]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleShop = (id, on) => {
    const next = on ? [...new Set([...shopsOn, id])] : shopsOn.filter((x) => x !== id);
    if (next.length) setShopsOn(STORES.map((s) => s.id).filter((x) => next.includes(x)));
  };

  return (
    <>
      <header className="head">
        <div className="head-inner">
          <h1>Food Planner</h1>
          <p className="meta">
            {needed.length} to buy{items.length > needed.length ? ` · ${items.length - needed.length} already at home` : ''} · prices from{' '}
            {new Date(DATA.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </p>
          <div className="totals" style={{ gridTemplateColumns: `repeat(${active.length}, 1fr)` }}>
            {active.map((s) => (
              <div key={s.id} className={'tot ' + s.id}>
                <span className="tot-s">{s.label}</span>
                <span className="tot-n">{gbp(totals[s.id])}</span>
                <span className="tot-c">{counts[s.id]} of {needed.length} priced</span>
              </div>
            ))}
          </div>
          {vsMorrisons.length > 0 && (
            <p className="verdict">
              Same items vs Morrisons:{' '}
              {vsMorrisons.map((c, i) => (
                <span key={c.s.id}>
                  {i > 0 && ' · '}
                  {c.s.label} <b className={c.diff >= 0 ? '' : 'dearer'}>{Math.abs(c.pct)}% {c.diff >= 0 ? 'cheaper' : 'dearer'}</b> ({c.n} items)
                </span>
              ))}
            </p>
          )}
        </div>
      </header>

      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className="tabs">
          <Tabs.Tab className="tab" value="plan">Plan</Tabs.Tab>
          <Tabs.Tab className="tab" value="shop">Shop</Tabs.Tab>
          <Tabs.Tab className="tab" value="compare">Compare</Tabs.Tab>
          <Tabs.Indicator className="tab-ind" />
        </Tabs.List>

        <Tabs.Panel value="plan" className="panel">
          <PlanPanel
            sample={sample} plan={plan} setPlan={setPlan} items={items} isExample={isExample}
            pantrySet={pantrySet} pantry={pantry} setPantry={setPantry} toast={toast} dbReady={dbReady} db={db} dishCosts={dishCosts}
            onDone={() => setTab('shop')}
          />
        </Tabs.Panel>

        <Tabs.Panel value="shop" className="panel">
          {dishCosts.some((d) => d.total > 0) && (
            <p className="portion-line">
              {dishCosts.filter((d) => d.total > 0).map((d, i) => (
                <span key={d.name}>{i > 0 && ' · '}<span className="cap">{d.name}</span> <b>{gbp(d.total / d.servings)}</b> a portion</span>
              ))}
            </p>
          )}
          <label className="switch-row">
            <Switch.Root className="switch" checked={split} onCheckedChange={setSplit}>
              <Switch.Thumb className="switch-thumb" />
            </Switch.Root>
            Split between shops, cheapest first
          </label>
          {active.map((s) => {
            const mineRows = rows.filter((r) => (split ? r.best === s.id || (!r.best && s.id === 'morrisons') : true));
            return (
              <ShopList
                key={s.id} store={s} rows={mineRows} ticks={ticks[s.id] || {}}
                onTick={(r, v) => tick(s.id, r, v)}
                onPick={(k, v) => setPick(s.id, k, v)}
                onQty={(k, name, n) => setQty({ ...qty, [s.id]: { ...(qty[s.id] || {}), [k]: { name, n } } })}
                where={s.id === 'morrisons' ? { placeOf, nameOf: nameAtMorrisons, map: storeMap, learned, zones: pickerZones, onTag: saveTag } : null}
              />
            );
          })}
          {queue.length > 0 && !isExample && (
            <p className="note">Not priced at Morrisons yet: {queue.join(', ')}. Your laptop looks these up overnight.</p>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="compare" className="panel">
          <Basket rows={rows} active={active} vsMorrisons={vsMorrisons} toggleShop={toggleShop} isExample={isExample} />
          {rows.map((r) => (
            <CompareRow key={r.k} r={r} active={active} onPick={(sid, v) => setPick(sid, r.k, v)}
              onPrice={(price) => {
                const lidl = { ...(mine.lidl || {}) };
                if (price > 0) lidl[r.k] = { price, date: new Date().toISOString().slice(0, 10) };
                else delete lidl[r.k];
                setMine({ ...mine, lidl });
                toast.add({ title: price > 0 ? `Saved Lidl price for ${r.it.item}` : `Removed your Lidl price for ${r.it.item}` });
              }}
            />
          ))}
          <p className="note">Cheaper is judged per kg or litre when every shop shows it, otherwise per pack, so check sizes then. Totals are what you'd pay for the packs shown.</p>
        </Tabs.Panel>
      </Tabs.Root>
    </>
  );
}

function PlanPanel({ sample, plan, setPlan, items, isExample, pantrySet, pantry, setPantry, toast, onDone, db, dishCosts }) {
  const [meals, setMeals] = useState(plan.meals || '');
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState('');
  const [extra, setExtra] = useState('');
  const ctl = useRef(null);
  useEffect(() => { if (plan.meals && !meals) setMeals(plan.meals); }, [plan.meals]); // eslint-disable-line

  async function make() {
    if (!sample || !meals.trim()) return;
    ctl.current = new AbortController();
    setBusy(true); setError(''); setQueued(false);
    try {
      const { dishes, items: list } = await ingredientsFor(sample, meals.trim(), ctl.current.signal, () => setQueued(true));
      setPlan({ meals: meals.trim(), items: list, dishes });
      toast.add({ title: `${list.length} ingredients`, description: 'Untick anything you already have.' });
    } catch (e) {
      setError(sampleErrorText(e));
    } finally {
      setBusy(false); setQueued(false);
    }
  }

  const togglePantry = (item, have) => {
    const k = key(item);
    setPantry(have ? [...new Set([...pantry, k])] : pantry.filter((p) => key(p) !== k));
  };
  const addExtra = () => {
    const name = extra.trim().toLowerCase();
    if (!name) return;
    setPlan({ meals: plan.meals || '', items: [...(plan.items || items), { item: name, amount: null, unit: '', meals: [], staple: false }] });
    setExtra('');
  };
  const removeItem = (i) => {
    const list = [...(plan.items || items)];
    list.splice(i, 1);
    setPlan({ meals: plan.meals || '', items: list });
  };

  const byMeal = items;
  return (
    <div className="plan">
      <label className="label" htmlFor="meals">What are you cooking?</label>
      <textarea
        id="meals" className="meals" rows={3} value={meals} onChange={(e) => setMeals(e.target.value)}
        placeholder="e.g. big tray of veggie lasagna for 8, chickpea curry for 4, stir-fry for 2"
      />
      <div className="row-actions">
        {busy ? (
          <>
            <button className="btn primary" disabled>{queued ? 'Waiting for your Mac…' : 'Asking Claude…'}</button>
            <button className="btn" onClick={() => ctl.current?.abort()}>Stop</button>
          </>
        ) : (
          <button className="btn primary" onClick={make} disabled={!sample || !meals.trim()}>Make my list</button>
        )}
        {items.length > 0 && !busy && <button className="btn" onClick={onDone}>Go to shop list</button>}
      </div>
      {queued && <p className="note">Your Mac makes the list and usually answers within a few minutes. Keep this page open.</p>}
      {sample === null && (
        <p className="note">{isWeb() ? 'Open your personal link once on this device to make lists from meals.' : 'Making a list from meals works when this page is open in Claude. You can still edit the list below.'}</p>
      )}
      {error && <p className="error">{error}</p>}
      {db === null && <p className="note">{isWeb() ? 'Your list is saved on this device only. Open your personal link to keep it in sync between phone and laptop.' : 'Your list is saved on this device only. Open the page in Claude to keep it in sync between phone and laptop.'}</p>}

      <DishCosts dishCosts={dishCosts} />

      <h2 className="h2">
        <span>{isExample ? 'Example: veggie lasagna for 8' : 'Ingredients'}</span>
        <span className="h2-n">tick what you have at home</span>
      </h2>
      <ul className="ing">
        {byMeal.map((it, i) => {
          const have = pantrySet.has(key(it.item));
          return (
            <li key={it.item + i} className={'ing-row' + (have ? ' have' : '')}>
              <label className="ing-label">
                <Checkbox.Root className="cb" checked={have} onCheckedChange={(v) => togglePantry(it.item, v)} aria-label={`I have ${it.item}`}>
                  <Checkbox.Indicator className="cb-ind"><Check /></Checkbox.Indicator>
                </Checkbox.Root>
                <span className="ing-name">{it.item}</span>
              </label>
              <span className="ing-amt">{needText(it)}</span>
              {it.staple && !have && <span className="pill">usually in the cupboard</span>}
              {!isExample && <button className="x" onClick={() => removeItem(i)} aria-label={`Remove ${it.item}`}>×</button>}
            </li>
          );
        })}
      </ul>
      <div className="add-row">
        <label className="sr" htmlFor="extra">Add an item</label>
        <input id="extra" className="input" value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addExtra()} placeholder="Add an item, e.g. bananas" />
        <button className="btn" onClick={addExtra} disabled={!extra.trim()}>Add</button>
      </div>
      {pantry.length > 0 && (
        <>
          <h2 className="h2"><span>Always at home</span><span className="h2-n">skipped on every list</span></h2>
          <div className="chips">
            {pantry.map((p) => (
              <button key={p} className="chip" onClick={() => togglePantry(p, false)} aria-label={`Remove ${p} from always at home`}>{p} ×</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Thumb({ src, big }) {
  const [bad, setBad] = useState(false);
  const cls = 'thumb' + (big ? ' big' : '');
  return src && !bad ? <img className={cls} loading="lazy" alt="" src={src} onError={() => setBad(true)} /> : <span className={cls + ' ph'} aria-hidden="true">🛒</span>;
}

function Tag({ o }) {
  if (!o) return null;
  if (o.source === 'you') return <span className="tag">Added by you</span>;
  if (o.similar) return <span className="tag">Similar: {o.similar}</span>;
  if (/^specially selected/i.test(o.name)) return <span className="tag">Aldi premium range</span>;
  if (o.source === 'receipt') return <span className="tag">From a receipt{o.date ? `, ${o.date}` : ''}{o.match === false ? ' · check item' : ''}</span>;
  return o.offer ? <span className="tag offer">{o.offer}</span> : null;
}

// ---- Choosing a pack: size line, three one-tap choices, step through options, big-pack warning ----

const money = (x) => (x < 1 ? `${Math.round(x * 100)}p` : gbp(x));
const ratioText = (x) => `${x < 10 ? +x.toFixed(1) : Math.round(x)}×`;
const packSizeText = (sel) =>
  !sel.size ? 'size not listed' : sel.size.loose ? 'loose, sold by the kg' : sel.count > 1 ? `${sel.count} × ${sizeText(sel.size)}` : sizeText(sel.size);

// "500g · £0.53 · £1.06/kg": what one option is.
function PackLine({ sel, short }) {
  if (!sel) return null;
  const u = perUnit(sel.opt);
  // short: the price is shown big right below, so only repeat it for "each".
  const price = short && sel.count <= 1 ? '' : ` · ${gbp(sel.opt.price)}${sel.count > 1 ? ' each' : ''}`;
  return (
    <div className="item-pack">
      <b>{packSizeText(sel)}</b>{price}{u ? ` · ${unitText(u)}` : ''}
    </div>
  );
}

// Loud, on purpose: you're about to buy several times what the recipe needs.
function BigPack({ sel, onPick }) {
  if (!sel?.big) return null;
  const need = sizeText({ qty: sel.need.qty, u: sel.need.u });
  const a = sel.alt;
  const d = a ? sel.cost - a.cost : 0;
  return (
    <div className="warn" role="note">
      <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
        <path d="M10 2.5 18.2 17H1.8L10 2.5Z" /><path d="M10 8v4.2M10 14.6v.1" strokeLinecap="round" />
      </svg>
      <div className="warn-t">
        <b>{sizeText(sel.total)}: {ratioText(sel.ratio)} what you need ({need})</b>
        {a ? (
          <span>
            Similar size: {a.count > 1 ? `${a.count} × ` : ''}{sizeText(a.size)} {gbp(a.cost)} (
            {Math.abs(d) < 0.005 ? 'same price' : d > 0 ? `${money(d)} less now` : `${money(-d)} more now`})
          </span>
        ) : (
          <span>No smaller pack listed here.</span>
        )}
      </div>
      {a && <button className="warn-b" onClick={() => onPick({ mode: 'similar' })}>Use best fit</button>}
    </div>
  );
}

// "Bigger pack: 1.5kg £0.70 · 56% less per kg · 3× what you need  [Switch]"
// Shown only when a pack at least 10% cheaper per kg exists than the one picked.
function Suggestion({ sel, alts, onPick }) {
  const u = alts?.unit;
  if (!sel || !u || u.opt.name === sel.opt.name) return null;
  const a = perUnit(u.opt), b = perUnit(sel.opt);
  if (!a || !b || a.u !== b.u || a.v > b.v * 0.9) return null;
  const pct = Math.round((1 - a.v / b.v) * 100);
  return (
    <div className="deal">
      <span>
        <b>Bigger pack:</b> {packSizeText(u)} {gbp(u.cost)} · {pct}% less per {a.u === 'l' ? 'litre' : a.u}
        {u.big ? <> · <span className="deal-big">{ratioText(u.ratio)} what you need</span></> : null}
      </span>
      <button className="deal-b" onClick={() => onPick({ mode: 'manual', name: u.opt.name })}>Switch</button>
    </div>
  );
}

// Every option at one shop, labelled, in a sheet that slides up (Base UI Drawer). Tap one to choose it.
function OptionsSheet({ sel, alts, it, what, onPick }) {
  const [open, setOpen] = useState(false);
  if (!sel || sel.order.length < 2) return null;
  const labels = (o) => [
    alts?.best?.opt.name === o.name && 'Best fit',
    alts?.unit?.opt.name === o.name && 'Cheapest per kg',
    alts?.pack?.opt.name === o.name && 'Cheapest pack',
  ].filter(Boolean);
  const choose = (o) => {
    onPick(alts?.best?.opt.name === o.name ? { mode: 'similar' } : { mode: 'manual', name: o.name });
    setOpen(false);
  };
  const rows = [...sel.order]
    .map((o) => ({ o, d: choosePack([o], it, { mode: 'similar' }), tags: labels(o) }))
    .sort((x, y) => (y.tags.length > 0) - (x.tags.length > 0) || (x.d?.cost ?? x.o.price) - (y.d?.cost ?? y.o.price));
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger className="link">See {sel.order.length} options</Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Backdrop className="backdrop" />
        <Drawer.Viewport className="sheet-vp">
          <Drawer.Popup className="sheet">
            <div className="sheet-handle" aria-hidden="true" />
            <Drawer.Title className="sheet-t">{what}</Drawer.Title>
            <Drawer.Description className="sheet-d">
              {sel.need ? `You need about ${sizeText({ qty: sel.need.qty, u: sel.need.u })}. ` : ''}Tap one to choose it.
            </Drawer.Description>
            <ul className="opts">
              {rows.map(({ o, d, tags }) => {
                const u = perUnit(o);
                const on = o.name === sel.opt.name;
                return (
                  <li key={o.name}>
                    <button className={'opt' + (on ? ' on' : '')} onClick={() => choose(o)} aria-pressed={on}>
                      <Thumb src={o.image} />
                      <span className="opt-main">
                        <span className="opt-name">{o.name}</span>
                        <span className="opt-sub">
                          {d ? packSizeText(d) : ''}{u ? ` · ${unitText(u)}` : ''}
                          {d?.big ? <span className="deal-big"> · {ratioText(d.ratio)} what you need</span> : null}
                        </span>
                        {(tags.length > 0 || on) && (
                          <span className="opt-tags">
                            {tags.map((l) => <span key={l} className="opt-tag">{l}</span>)}
                            {on && <span className="opt-tag on">Chosen</span>}
                          </span>
                        )}
                      </span>
                      <span className="opt-pr">{gbp(d ? d.cost : o.price)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <Drawer.Close className="btn sheet-close">Done</Drawer.Close>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// Under each item: the oversized warning if any, a cheaper-bigger-pack suggestion, and "See options".
function PickPanel({ r, sid, onPick }) {
  const sel = r.sel[sid];
  if (!sel) return null;
  const what = `${r.it.item} at ${STORES.find((s) => s.id === sid).label}`;
  return (
    <div className="item-pick">
      <BigPack sel={sel} onPick={onPick} />
      {!sel.big && <Suggestion sel={sel} alts={r.alts[sid]} onPick={onPick} />}
      <OptionsSheet sel={sel} alts={r.alts[sid]} it={r.it} what={what} onPick={onPick} />
    </div>
  );
}

function DishCosts({ dishCosts }) {
  const shown = dishCosts.filter((d) => d.total > 0);
  if (!shown.length) return null;
  return (
    <section className="dishes" aria-label="Cost per portion">
      {shown.map((d) => (
        <div key={d.name} className="dish">
          <div className="dish-top">
            <span className="dish-name">{d.name}</span>
            <span className="dish-pp"><b>{gbp(d.total / d.servings)}</b> a portion</span>
          </div>
          <div className="dish-sub">
            Serves {d.servings}{d.assumed ? ' (assumed)' : ''} · {gbp(d.total)} of ingredients at Morrisons
            {d.split < d.total - 0.05 && <> · {gbp(d.split / d.servings)} a portion with the cheapest split</>}
          </div>
          {d.missing.length > 0 && <div className="dish-note">Not counted (no amount or price yet): {d.missing.join(', ')}</div>}
        </div>
      ))}
      <p className="note">Counts what each meal uses, not whole packs, and includes cupboard items at their shop price.</p>
    </section>
  );
}

function Qty({ value, onChange, label }) {
  return (
    <NumberField.Root className="qty" value={value} min={0} max={20} step={1} onValueChange={(v) => v != null && onChange(v)}>
      <NumberField.Group className="qty-g">
        <NumberField.Decrement className="qty-b" aria-label={`One less ${label}`}>−</NumberField.Decrement>
        <NumberField.Input className="qty-i" aria-label={`Packs of ${label}`} />
        <NumberField.Increment className="qty-b" aria-label={`One more ${label}`}>+</NumberField.Increment>
      </NumberField.Group>
    </NumberField.Root>
  );
}

const SIDES = ['left', 'right'];
const SHELVES = ['top', 'middle', 'bottom'];

// "Aisle 7 · left · middle" under each Morrisons item, or "Add aisle". Tap to tag it yourself:
// a bottom sheet (Base UI Drawer, like the pack options) with the aisle, side, shelf and a note.
function AisleChip({ name, place, zones, onTag }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState({ zone: '', zoneLabel: '', side: '', shelf: '', note: '' });
  const known = place.zone ? placeText(place) : '';
  const start = (o) => {
    setOpen(o);
    // Start from what we already think, so you only fix the part that's wrong.
    if (o) setD({ zone: zones.some((z) => z.id === place.zone?.id) ? place.zone.id : '', zoneLabel: '', side: place.side, shelf: place.shelf, note: place.note });
  };
  const customs = zones.filter((z) => z.id.startsWith(CUSTOM_PREFIX));
  const label = d.zone === '__other' ? d.zoneLabel.trim() : '';
  const ready = d.zone && (d.zone !== '__other' || label);
  const save = () => {
    const custom = d.zone === '__other';
    const z = custom ? { id: customId(label), label } : zones.find((x) => x.id === d.zone);
    onTag(name, makeTag({ zone: z.id, zoneLabel: z.id.startsWith(CUSTOM_PREFIX) ? z.label : '', side: d.side, shelf: d.shelf, note: d.note }));
    setOpen(false);
  };
  return (
    <Drawer.Root open={open} onOpenChange={start}>
      <Drawer.Trigger className={'aisle' + (known ? '' : ' empty') + (place.source === 'you' ? ' mine' : '')} aria-label={known ? `Where it is: ${known}. Change` : `Add aisle for ${name}`}>
        <span className="aisle-t">{known || 'Add aisle'}</span>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Backdrop className="backdrop" />
        <Drawer.Viewport className="sheet-vp">
          <Drawer.Popup className="sheet">
            <div className="sheet-handle" aria-hidden="true" />
            <Drawer.Title className="sheet-t">Where is {name}?</Drawer.Title>
            <Drawer.Description className="sheet-d">
              {place.source === 'you' ? 'Your own tag.' : place.source === 'map' ? 'From the store map. Change it if it’s wrong.' : place.source === 'category' ? 'A guess from its category. Change it if it’s wrong.' : 'Not known yet. This will be remembered.'}
            </Drawer.Description>
            <label className="field-l" htmlFor="aisle-zone">Aisle or area</label>
            <select id="aisle-zone" className="input select" value={d.zone} onChange={(e) => setD((p) => ({ ...p, zone: e.target.value }))}>
              <option value="">Choose…</option>
              {zones.filter((z) => !z.id.startsWith(CUSTOM_PREFIX)).map((z) => <option key={z.id} value={z.id}>{zoneHeading(z)}</option>)}
              {customs.map((z) => <option key={z.id} value={z.id}>{z.label} (yours)</option>)}
              <option value="__other">Other…</option>
            </select>
            {d.zone === '__other' && (
              <>
                <label className="sr" htmlFor="aisle-other">Name of the aisle or area</label>
                <input id="aisle-other" className="input" placeholder="e.g. Back wall, End of aisle 4" value={d.zoneLabel} onChange={(e) => setD((p) => ({ ...p, zoneLabel: e.target.value }))} />
              </>
            )}
            <div className="field-l" id="aisle-side-l">Side</div>
            <ToggleGroup className="seg" aria-labelledby="aisle-side-l" value={d.side ? [d.side] : []} onValueChange={(v) => setD((p) => ({ ...p, side: v[0] || '' }))}>
              {SIDES.map((x) => <Toggle key={x} value={x} className="seg-b">{x}</Toggle>)}
            </ToggleGroup>
            <div className="field-l" id="aisle-shelf-l">Shelf</div>
            <ToggleGroup className="seg" aria-labelledby="aisle-shelf-l" value={d.shelf ? [d.shelf] : []} onValueChange={(v) => setD((p) => ({ ...p, shelf: v[0] || '' }))}>
              {SHELVES.map((x) => <Toggle key={x} value={x} className="seg-b">{x}</Toggle>)}
            </ToggleGroup>
            <label className="field-l" htmlFor="aisle-note">Note (optional)</label>
            <input id="aisle-note" className="input" placeholder="e.g. by the bread, bottom bin" value={d.note} onChange={(e) => setD((p) => ({ ...p, note: e.target.value }))} />
            <div className="row-actions sheet-actions">
              <button className="btn primary big" onClick={save} disabled={!ready}>Save</button>
              {place.source === 'you' && <button className="btn big" onClick={() => { onTag(name, null); setOpen(false); }}>Remove my tag</button>}
              <Drawer.Close className="btn big">Cancel</Drawer.Close>
            </div>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// One shopping item: photo, name, pack, price, aisle chip, tick, and the pack options.
function ShopItem({ store, r, done, onTick, onPick, onQty, chip }) {
  const o = r.chosen[store.id];
  const sel = r.sel[store.id];
  return (
    <div className={'item' + (done ? ' done' : '') + (sel?.count === 0 ? ' none' : '')}>
      <button type="button" className="item-photo" aria-pressed={done} onClick={() => onTick(r, !done)}
        aria-label={done ? `${o ? o.name : r.it.item}: in your basket. Tap to undo` : `Got ${o ? o.name : r.it.item}`}>
        <Thumb src={o?.image} big />
        <span className="got" aria-hidden="true"><Check /></span>
      </button>
      <div className="item-main">
        <div className="item-name">{o ? o.name : r.it.item}</div>
        <PackLine sel={sel} short />
        <div className="item-foot">
          <span className="item-price">{r.cost[store.id] != null ? gbp(r.cost[store.id]) : 'No price'}</span>
          {sel && !sel.size?.loose && <Qty value={sel.count} label={o.name} onChange={(n) => onQty(r.k, o.name, n)} />}
        </div>
        <Tag o={o} />
        {chip}
      </div>
      <PickPanel r={r} sid={store.id} onPick={(v) => onPick(r.k, v)} />
    </div>
  );
}

// `where` is only passed for Morrisons: its store map, your tags and the learned walking order.
function ShopList({ store, rows, ticks, onTick, onPick, onQty, where }) {
  const hasMap = !!where && where.map.zones.length > 0;
  // Until you pick one, a map means "in the order you walk", no map means the old category grouping.
  const [chosen, setChosen] = useState(null);
  const mode = where ? chosen ?? (hasMap ? 'store' : 'category') : 'category';
  if (!rows.length) return null;
  const total = rows.reduce((a, r) => a + (r.cost[store.id] ?? 0), 0);
  const left = rows.filter((r) => !ticks[r.k]).length;

  let groups;
  if (mode === 'store') {
    groups = groupByZone(rows, where.placeOf, where.nameOf, where.map, where.learned).map((g) => ({ key: g.zone?.id || 'none', title: zoneHeading(g.zone), rows: g.rows }));
  } else {
    const byCat = {};
    for (const r of rows) {
      const o = r.chosen[store.id];
      const g = o ? (o.category || []).slice(0, 2).join(' › ') || 'Other' : 'Not priced here';
      (byCat[g] ||= []).push(r);
    }
    groups = Object.keys(byCat).sort((a, b) => (a === 'Not priced here') - (b === 'Not priced here') || a.localeCompare(b)).map((g) => ({ key: g, title: g, rows: byCat[g] }));
  }

  return (
    <section className="shop">
      <h2 className={'shop-h ' + store.id}>
        <span>{store.label} {store.place}</span>
        <span>{left} left · {gbp(total)}</span>
      </h2>
      {where && (
        <>
          <ToggleGroup className="seg" aria-label="Order of the list" value={[mode]} onValueChange={(v) => v[0] && setChosen(v[0])}>
            <Toggle value="store" className="seg-b">Store order</Toggle>
            <Toggle value="category" className="seg-b">By category</Toggle>
          </ToggleGroup>
          {mode === 'store' && !hasMap && <p className="note">No store map yet. Tap “Add aisle” on an item to say where it is. Your order of ticking is remembered, and the list follows it after a few trips.</p>}
        </>
      )}
      {groups.map((g) => (
        <div key={g.key}>
          <h3 className="h3">{g.title}</h3>
          {g.rows.map((r) => (
            <ShopItem
              key={r.k} store={store} r={r} done={!!ticks[r.k]} onTick={onTick} onPick={onPick} onQty={onQty}
              chip={where && <AisleChip name={where.nameOf(r)} place={where.placeOf(r)} zones={where.zones} onTag={where.onTag} />}
            />
          ))}
        </div>
      ))}
    </section>
  );
}

// Your whole list at each shop, and like-for-like against Morrisons.
function Basket({ rows, active, vsMorrisons, toggleShop, isExample }) {
  const total = (id) => rows.reduce((a, r) => a + (r.cost[id] ?? 0), 0);
  const count = (id) => rows.filter((r) => r.cost[id] != null).length;
  return (
    <section className="basket" aria-label="Your basket">
      <div className="basket-h">
        <span className="basket-t">{isExample ? 'Example basket' : 'Your basket'}: {rows.length} items</span>
        <div className="shop-chips" role="group" aria-label="Shops to compare">
          {STORES.map((s) => {
            const on = active.some((a) => a.id === s.id);
            return (
              <button key={s.id} type="button" className={'chip ' + s.id + (on ? ' on' : '')} aria-pressed={on}
                onClick={() => toggleShop(s.id, !on)} disabled={on && active.length === 1}>
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
      <table className="basket-tb">
        <thead>
          <tr><th scope="col">Shop</th><th scope="col">Whole list</th><th scope="col">Same items as Morrisons</th></tr>
        </thead>
        <tbody>
          {active.map((s) => {
            const c = vsMorrisons.find((x) => x.s.id === s.id);
            return (
              <tr key={s.id}>
                <th scope="row" className={'basket-s ' + s.id}>{s.label}</th>
                <td>
                  <b>{gbp(total(s.id))}</b>
                  <span className="basket-n">{count(s.id)} of {rows.length} listed</span>
                </td>
                <td>
                  {s.id === 'morrisons' ? <span className="basket-n">the reference</span> : c ? (
                    <>
                      <b>{gbp(c.o)}</b> vs {gbp(c.m)}
                      <span className={'basket-n ' + (c.diff > 0.005 ? 'good' : c.diff < -0.005 ? 'bad' : '')}>
                        {c.n} items · {Math.abs(c.diff) < 0.005 ? 'same' : `${gbp(Math.abs(c.diff))} ${c.diff > 0 ? 'cheaper' : 'dearer'} (${Math.abs(c.pct)}%)`}
                      </span>
                    </>
                  ) : <span className="basket-n">nothing in common yet</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {active.some((s) => s.id === 'aldi') && (
        <p className="note">Aldi prices come from aldi.co.uk (about 1,000 everyday products from its category pages, plus items looked up one by one; checked 1 Nov). Some products are on Aldi’s site without a price, so they can’t be compared. Lidl only shows part of its range online; Aldi’s prices are usually close to Lidl’s.</p>
      )}
    </section>
  );
}

function CompareRow({ r, active, onPrice, onPick }) {
  const priced = active.filter((s) => r.cost[s.id] != null);
  const vals = priced.map((s) => ({ id: s.id, v: r.value(s.id) })).sort((a, b) => a.v - b.v);
  // Cheapest wins only when it's more than 2% below the next one.
  const winner = vals.length > 1 && vals[0].v < vals[1].v * 0.98 ? vals[0].id : null;
  const ref = winner && (winner !== 'morrisons' && r.cost.morrisons != null ? vals.find((x) => x.id === 'morrisons') : vals[1]);
  const pct = winner ? Math.round(((ref.v - vals[0].v) / ref.v) * 100) : 0;
  return (
    <div className="cmp">
      <div className="cmp-top">
        <span className="cmp-t">{r.it.item}</span>
        {winner && <span className={'badge ' + winner}>{label(winner)} {pct}% less than {label(ref.id)} {r.basis}</span>}
      </div>
      <div className="cmp-cols" style={{ gridTemplateColumns: `repeat(${active.length}, minmax(0, 1fr))` }}>
        {active.map((s) => {
          const o = r.chosen[s.id];
          const sel = r.sel[s.id];
          return (
            <div key={s.id} className={'side ' + s.id + (winner === s.id ? ' win' : '')}>
              <span className="side-st">{s.label}</span>
              {o ? (
                <>
                  <span className="side-pr">{gbp(r.cost[s.id])}</span>
                  {r.unit[s.id] && <span className="side-u">{unitText(r.unit[s.id])}</span>}
                  <span className="side-pack">{packSizeText(sel)}{sel.count > 1 ? ` · ${gbp(o.price)} each` : ''}</span>
                  <span className="side-nm">{o.name}</span>
                  <Tag o={o} />
                  <BigPack sel={sel} onPick={(v) => onPick(s.id, v)} />
                  <OptionsSheet sel={sel} alts={r.alts[s.id]} it={r.it} what={`${r.it.item} at ${s.label}`} onPick={(v) => onPick(s.id, v)} />
                </>
              ) : s.id === 'aldi' && aldiNoPrice(r.k) ? (
                <span className="side-nm">On Aldi’s site, but no price shown right now ({aldiNoPrice(r.k)[0].name})</span>
              ) : (
                <span className="side-nm">Not listed online</span>
              )}
              {s.id === 'lidl' && <PriceDialog item={r.it.item} current={o?.source === 'you' ? o.price : null} onSave={onPrice} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PriceDialog({ item, current, onSave }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');
  const id = 'price-' + item.replace(/\W+/g, '-');
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) setVal(current ? current.toFixed(2) : ''); }}>
      <Dialog.Trigger className="link">{current ? 'Edit my price' : '+ Add Lidl price'}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="backdrop" />
        <Dialog.Popup className="dialog">
          <Dialog.Title className="dialog-t">Lidl price for {item}</Dialog.Title>
          <Dialog.Description className="dialog-d">One pack, as on the shelf label or receipt.</Dialog.Description>
          <form onSubmit={(e) => { e.preventDefault(); const p = parseFloat(val.replace(/[£\s]/g, '')); if (p > 0) { onSave(p); setOpen(false); } }}>
            <label className="sr" htmlFor={id}>Price in pounds</label>
            <input id={id} className="input" inputMode="decimal" autoFocus placeholder="e.g. 0.59" value={val} onChange={(e) => setVal(e.target.value)} />
            <div className="row-actions">
              <button className="btn primary" type="submit" disabled={!(parseFloat(val) > 0)}>Save</button>
              {current && <button className="btn" type="button" onClick={() => { onSave(0); setOpen(false); }}>Remove</button>}
              <Dialog.Close className="btn" type="button">Cancel</Dialog.Close>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
