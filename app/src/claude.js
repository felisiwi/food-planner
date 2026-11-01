// Live page features from the Claude viewer: asking Claude, and shared storage.
// Both may be unavailable (opened outside Claude, signed out, declined); the
// app then works from the embedded example list and browser storage.
import { useEffect, useState } from 'react';

export function useCapability(name) {
  const [cap, setCap] = useState(undefined); // undefined = still loading, null = unavailable
  useEffect(() => {
    let live = true;
    const c = window.claude;
    if (!c?.use) { setCap(null); return; }
    c.use(name).then((v) => live && setCap(v ?? null), () => live && setCap(null));
    return () => { live = false; };
  }, [name]);
  return cap;
}

// One shared document (state/<key>) with live updates, falling back to
// browser storage when the db isn't available.
export function useDoc(db, key, initial) {
  const [value, setValue] = useState(() => {
    try { return JSON.parse(localStorage.getItem('fp-' + key)) ?? initial; } catch { return initial; }
  });
  useEffect(() => {
    if (!db) return;
    const unsub = db.doc('state/' + key).onSnapshot(
      (snap) => { if (snap.exists) setValue(snap.data().value); },
      () => {},
    );
    return () => unsub?.();
  }, [db, key]);
  const save = (next) => {
    setValue(next);
    try { localStorage.setItem('fp-' + key, JSON.stringify(next)); } catch {}
    if (db) db.doc('state/' + key).set({ value: next, updatedAt: Date.now() }).catch(() => {});
  };
  return [value, save];
}

export async function ingredientsFor(sample, meals, signal) {
  const prompt = `You plan a UK supermarket shop (Morrisons and Lidl).
Meals to cook, with servings where given:
${meals}

List every ingredient needed, merged across meals and scaled to the servings (assume 2 servings if none given).
For each ingredient return:
- "item": a short generic supermarket search term in UK English, lowercase, no brands or sizes (e.g. "chopped tomatoes", "brown onions", "vegetarian mince", "mature cheddar")
- "amount": a number, and "unit": one of "g", "kg", "ml", "l", "tin", "pack", "item", "bunch", "tsp", "tbsp"
- "meals": the meal names it's for
- "staple": true for store-cupboard things most kitchens already have (oil, salt, pepper, dried herbs and spices, sugar, vinegar), else false
Reply with only a JSON array, e.g. [{"item":"chopped tomatoes","amount":3,"unit":"tin","meals":["veggie lasagna"],"staple":false}]`;
  const list = await sample.json(prompt, { signal });
  if (!Array.isArray(list)) throw { code: 'invalid_json' };
  return list
    .filter((x) => x && typeof x.item === 'string' && x.item.trim())
    .map((x) => ({
      item: x.item.trim().toLowerCase(),
      amount: Number(x.amount) || null,
      unit: typeof x.unit === 'string' ? x.unit : '',
      meals: Array.isArray(x.meals) ? x.meals.map(String) : [],
      staple: !!x.staple,
    }));
}

export function sampleErrorText(e) {
  switch (e?.code) {
    case 'not_granted': return 'Asking Claude isn’t allowed for this page. You can allow it in the page’s permissions.';
    case 'rate_limited': return 'Too many requests right now. Try again in a little while.';
    case 'invalid_json': return 'Claude’s answer couldn’t be read as a list. Try again, or describe the meals more simply.';
    case 'refused': return 'Claude declined that request. Try rewording the meals.';
    case 'cancelled': return '';
    case 'session_expired': return 'Sign in to Claude again, then try again.';
    default: return 'Something went wrong asking Claude. Try again.';
  }
}
