// Live page features from the Claude viewer: asking Claude, and shared storage.
// Both may be unavailable (opened outside Claude, signed out, declined); the
// app then works from the embedded example list and browser storage.
import { useEffect, useState } from 'react';
import { ingredientsPrompt, cleanIngredients } from '../../lib/ingredients.mjs';

export function useCapability(name) {
  const [cap, setCap] = useState(undefined); // undefined = still loading, null = unavailable
  useEffect(() => {
    let live = true;
    const web = window.__FP_WEB__;
    if (web) { setCap(web[name] ?? null); return; }
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

export async function ingredientsFor(sample, meals, signal, onWait) {
  if (sample.web) return cleanIngredients(await sample.meals(meals, { signal, onWait }));
  return cleanIngredients(await sample.json(ingredientsPrompt(meals), { signal }));
}

export function sampleErrorText(e) {
  switch (e?.code) {
    case 'not_granted': return 'Asking Claude isn’t allowed for this page. You can allow it in the page’s permissions.';
    case 'rate_limited': return 'Too many requests right now. Try again in a little while.';
    case 'invalid_json': return 'Claude’s answer couldn’t be read as a list. Try again, or describe the meals more simply.';
    case 'refused': return 'Claude declined that request. Try rewording the meals.';
    case 'cancelled': return '';
    case 'not_allowed': return 'This device isn’t signed in to your household. Open your personal link again.';
    case 'timeout': return 'Nothing answered in 30 minutes. Your Mac may be asleep; try again once it’s awake.';
    case 'worker': return 'The list couldn’t be made. Try again, or describe the meals more simply.';
    case 'session_expired': return 'Sign in to Claude again, then try again.';
    default: return 'Something went wrong asking Claude. Try again.';
  }
}
