import { useEffect, useMemo, useRef, useState } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { Checkbox } from '@base-ui/react/checkbox';
import { Switch } from '@base-ui/react/switch';
import { Dialog } from '@base-ui/react/dialog';
import { Toast } from '@base-ui/react/toast';
import { DATA, morrisonsFor, lidlFor, gbp, perUnit, unitText, orderOptions } from './data.js';
import { useCapability, useDoc, ingredientsFor, sampleErrorText } from './claude.js';

const STORES = [
  { id: 'morrisons', label: 'Morrisons', place: 'Stamford Hill' },
  { id: 'lidl', label: 'Lidl', place: 'Amhurst Park' },
];
const key = (s) => s.trim().toLowerCase();
const packs = (it) => (['tin', 'pack'].includes(it.unit) && it.amount > 1 ? Math.round(it.amount) : 1);
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
  const [queue, setQueue] = useDoc(db || null, 'queue', []);
  const [tab, setTab] = useState('plan');
  const [split, setSplit] = useState(true);
  const [byUnit, setByUnit] = useState(() => { try { return localStorage.getItem('fp-byunit') === '1'; } catch { return false; } });

  const items = plan.items || DATA.example || [];
  const isExample = !plan.items;
  const pantrySet = useMemo(() => new Set(pantry.map(key)), [pantry]);
  const needed = items.filter((it) => !it.skip && !pantrySet.has(key(it.item)));

  // Options per store for each needed item; your own prices come first.
  const rows = useMemo(
    () =>
      needed.map((it) => {
        const k = key(it.item);
        const mode = byUnit ? 'unit' : 'pack';
        const opts = {
          morrisons: orderOptions(morrisonsFor(k), mode),
          lidl: orderOptions([
            ...(mine.lidl?.[k] ? [{ name: it.item, price: mine.lidl[k].price, date: mine.lidl[k].date, source: 'you', match: true, category: [] }] : []),
            ...lidlFor(k),
          ], mode),
        };
        const chosen = {};
        for (const s of STORES) {
          const o = opts[s.id];
          chosen[s.id] = o.length ? o[(picks[s.id]?.[k] || 0) % o.length] : null;
        }
        const cost = Object.fromEntries(STORES.map((s) => [s.id, chosen[s.id] ? chosen[s.id].price * packs(it) : null]));
        const unit = Object.fromEntries(STORES.map((s) => [s.id, perUnit(chosen[s.id])]));
        // Compare per kg/l when both shops give the same unit, otherwise per pack.
        const sameUnit = unit.morrisons && unit.lidl && unit.morrisons.u === unit.lidl.u;
        const value = (id) => (sameUnit ? unit[id].v : cost[id]);
        const known = STORES.filter((s) => cost[s.id] != null).sort((a, b) => value(a.id) - value(b.id));
        return { it, k, opts, chosen, cost, unit, basis: sameUnit ? 'per ' + unit.lidl.u : 'per pack', value, best: known[0]?.id || null };
      }),
    [needed, mine, picks, byUnit],
  );

  // Ingredients with no Morrisons price yet go on the laptop's to-do list.
  useEffect(() => {
    if (!db || isExample) return;
    const missing = rows.filter((r) => !r.opts.morrisons.length).map((r) => r.k);
    const next = [...new Set([...queue, ...missing])];
    if (next.length !== queue.length) setQueue(next);
  }, [db, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = Object.fromEntries(STORES.map((s) => [s.id, rows.reduce((a, r) => a + (r.cost[s.id] ?? 0), 0)]));
  const counts = Object.fromEntries(STORES.map((s) => [s.id, rows.filter((r) => r.cost[s.id] != null).length]));
  const splitTotal = rows.reduce((a, r) => a + (r.best ? r.cost[r.best] : 0), 0);
  const both = rows.filter((r) => r.cost.morrisons != null && r.cost.lidl != null);
  const bothM = both.reduce((a, r) => a + r.cost.morrisons, 0);
  const bothL = both.reduce((a, r) => a + r.cost.lidl, 0);

  return (
    <>
      <header className="head">
        <div className="head-inner">
          <h1>Food Planner</h1>
          <p className="meta">
            {needed.length} to buy{items.length > needed.length ? ` · ${items.length - needed.length} already at home` : ''} · prices from{' '}
            {new Date(DATA.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </p>
          <div className="totals">
            {STORES.map((s) => (
              <div key={s.id} className={'tot ' + s.id}>
                <span className="tot-s">{s.label}</span>
                <span className="tot-n">{gbp(totals[s.id])}</span>
                <span className="tot-c">{counts[s.id]} of {needed.length} priced</span>
              </div>
            ))}
          </div>
          {both.length > 0 && (
            <p className="verdict">
              Priced at both ({both.length}): Morrisons {gbp(bothM)} vs Lidl {gbp(bothL)}.{' '}
              Cheapest split <b>{gbp(splitTotal)}</b>.
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
            pantrySet={pantrySet} pantry={pantry} setPantry={setPantry} toast={toast} dbReady={dbReady} db={db}
            onDone={() => setTab('shop')}
          />
        </Tabs.Panel>

        <Tabs.Panel value="shop" className="panel">
          <label className="switch-row">
            <Switch.Root className="switch" checked={split} onCheckedChange={setSplit}>
              <Switch.Thumb className="switch-thumb" />
            </Switch.Root>
            Split between shops, cheapest first
          </label>
          <label className="switch-row">
            <Switch.Root className="switch" checked={byUnit} onCheckedChange={(v) => { setByUnit(v); try { localStorage.setItem('fp-byunit', v ? '1' : '0'); } catch {} }}>
              <Switch.Thumb className="switch-thumb" />
            </Switch.Root>
            Pick by price per kg or litre (bigger packs often win)
          </label>
          {STORES.map((s) => {
            const mineRows = rows.filter((r) => (split ? r.best === s.id || (!r.best && s.id === 'morrisons') : true));
            return (
              <ShopList
                key={s.id} store={s} rows={mineRows} ticks={ticks[s.id] || {}}
                onTick={(k, v) => setTicks({ ...ticks, [s.id]: { ...(ticks[s.id] || {}), [k]: v } })}
                onSwap={(k, n) => setPicks({ ...picks, [s.id]: { ...(picks[s.id] || {}), [k]: ((picks[s.id]?.[k] || 0) + 1) % n } })}
              />
            );
          })}
          {queue.length > 0 && !isExample && (
            <p className="note">Not priced at Morrisons yet: {queue.join(', ')}. Your laptop looks these up overnight.</p>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="compare" className="panel">
          {rows.map((r) => (
            <CompareRow key={r.k} r={r}
              onPrice={(price) => {
                const lidl = { ...(mine.lidl || {}) };
                if (price > 0) lidl[r.k] = { price, date: new Date().toISOString().slice(0, 10) };
                else delete lidl[r.k];
                setMine({ ...mine, lidl });
                toast.add({ title: price > 0 ? `Saved Lidl price for ${r.it.item}` : `Removed your Lidl price for ${r.it.item}` });
              }}
            />
          ))}
          <p className="note">Cheaper is judged per kg or litre when both shops show it, otherwise per pack, so check sizes then.</p>
        </Tabs.Panel>
      </Tabs.Root>
    </>
  );
}

function PlanPanel({ sample, plan, setPlan, items, isExample, pantrySet, pantry, setPantry, toast, onDone, db }) {
  const [meals, setMeals] = useState(plan.meals || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [extra, setExtra] = useState('');
  const ctl = useRef(null);
  useEffect(() => { if (plan.meals && !meals) setMeals(plan.meals); }, [plan.meals]); // eslint-disable-line

  async function make() {
    if (!sample || !meals.trim()) return;
    ctl.current = new AbortController();
    setBusy(true); setError('');
    try {
      const list = await ingredientsFor(sample, meals.trim(), ctl.current.signal);
      setPlan({ meals: meals.trim(), items: list });
      toast.add({ title: `${list.length} ingredients`, description: 'Untick anything you already have.' });
    } catch (e) {
      setError(sampleErrorText(e));
    } finally {
      setBusy(false);
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
            <button className="btn primary" disabled>Asking Claude…</button>
            <button className="btn" onClick={() => ctl.current?.abort()}>Stop</button>
          </>
        ) : (
          <button className="btn primary" onClick={make} disabled={!sample || !meals.trim()}>Make my list</button>
        )}
        {items.length > 0 && !busy && <button className="btn" onClick={onDone}>Go to shop list</button>}
      </div>
      {sample === null && (
        <p className="note">Making a list from meals works when this page is open in Claude. You can still edit the list below.</p>
      )}
      {error && <p className="error">{error}</p>}
      {db === null && <p className="note">Your list is saved on this device only. Open the page in Claude to keep it in sync between phone and laptop.</p>}

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

function Thumb({ src }) {
  const [bad, setBad] = useState(false);
  return src && !bad ? <img className="thumb" loading="lazy" alt="" src={src} onError={() => setBad(true)} /> : <span className="thumb ph">🛒</span>;
}

function Tag({ o }) {
  if (!o) return null;
  if (o.source === 'you') return <span className="tag">Added by you</span>;
  if (o.source === 'receipt') return <span className="tag">From a receipt{o.date ? `, ${o.date}` : ''}{o.match === false ? ' · check item' : ''}</span>;
  return o.offer ? <span className="tag offer">{o.offer}</span> : null;
}

function ShopList({ store, rows, ticks, onTick, onSwap }) {
  if (!rows.length) return null;
  const groups = {};
  for (const r of rows) {
    const o = r.chosen[store.id];
    const g = o ? (o.category || []).slice(0, 2).join(' › ') || 'Other' : 'Not priced here';
    (groups[g] ||= []).push(r);
  }
  const total = rows.reduce((a, r) => a + (r.cost[store.id] ?? 0), 0);
  const left = rows.filter((r) => !ticks[r.k]).length;
  return (
    <section className="shop">
      <h2 className={'shop-h ' + store.id}>
        <span>{store.label} {store.place}</span>
        <span>{left} left · {gbp(total)}</span>
      </h2>
      {Object.keys(groups).sort((a, b) => (a === 'Not priced here') - (b === 'Not priced here') || a.localeCompare(b)).map((g) => (
        <div key={g}>
          <h3 className="h3">{g}</h3>
          {groups[g].map((r) => {
            const o = r.chosen[store.id];
            const done = !!ticks[r.k];
            const n = r.opts[store.id].length;
            return (
              <div key={r.k} className={'item' + (done ? ' done' : '')}>
                <Checkbox.Root className="cb big" checked={done} onCheckedChange={(v) => onTick(r.k, v)} aria-label={`Got ${r.it.item}`}>
                  <Checkbox.Indicator className="cb-ind"><Check /></Checkbox.Indicator>
                </Checkbox.Root>
                <Thumb src={o?.image} />
                <div className="item-main">
                  <div className="item-name">{o ? o.name : r.it.item}</div>
                  <div className="item-sub">
                    for “{r.it.item}”{needText(r.it) ? ` · need ${needText(r.it)}` : ''}
                  </div>
                  <Tag o={o} />
                  {n > 1 && <button className="link" onClick={() => onSwap(r.k, n)}>Swap ({r.opts[store.id].indexOf(o) + 1}/{n})</button>}
                </div>
                <div className="item-price">
                  {r.cost[store.id] != null ? gbp(r.cost[store.id]) : '–'}
                  {packs(r.it) > 1 && o && <span className="q">{packs(r.it)} × {gbp(o.price)}</span>}
                  {r.unit[store.id] && <span className="q">{unitText(r.unit[store.id])}</span>}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

function CompareRow({ r, onPrice }) {
  const m = r.cost.morrisons, l = r.cost.lidl;
  const both = m != null && l != null;
  const vm = both ? r.value('morrisons') : null, vl = both ? r.value('lidl') : null;
  const winner = both ? (vl < vm * 0.98 ? 'lidl' : vm < vl * 0.98 ? 'morrisons' : null) : null; // within 2% counts as the same
  const pct = winner ? Math.round((Math.abs(vm - vl) / Math.max(vm, vl)) * 100) : 0;
  return (
    <div className="cmp">
      <div className="cmp-top">
        <span className="cmp-t">{r.it.item}</span>
        {winner && <span className={'badge ' + winner}>{winner === 'lidl' ? 'Lidl' : 'Morrisons'} {pct}% cheaper {r.basis}</span>}
      </div>
      <div className="cmp-cols">
        {STORES.map((s) => {
          const o = r.chosen[s.id];
          return (
            <div key={s.id} className={'side ' + s.id + (winner === s.id ? ' win' : '')}>
              <span className="side-st">{s.label}</span>
              {o ? (
                <>
                  <span className="side-pr">{gbp(r.cost[s.id])}</span>
                  {r.unit[s.id] && <span className="side-u">{unitText(r.unit[s.id])}</span>}
                  <span className="side-nm">{o.name}</span>
                  <Tag o={o} />
                </>
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
