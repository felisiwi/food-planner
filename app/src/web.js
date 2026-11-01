// Web mode: the app opened as a normal website (not inside Claude).
// Prices come from /data.json; the plan, pantry, ticks and prices you add are
// kept in Supabase behind your household key, so phone and laptop stay in sync.
// The key arrives once in the link (#k=...) and is then remembered on the device.

export const SUPABASE_URL = 'https://lkvedgtzgxiykcqemqkk.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_naUK87EG4MbaLgl-Io6YbA_Yf7a3Wgy';

export function householdKey() {
  const m = location.hash.match(/[#&]k=([\w-]+)/);
  if (m) {
    try { localStorage.setItem('fp-household', m[1]); } catch {}
    history.replaceState(null, '', location.pathname + location.search);
    return m[1];
  }
  try { return localStorage.getItem('fp-household') || null; } catch { return null; }
}

export async function rpc(name, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(body?.message || 'request failed'), { status: res.status, code: res.status === 403 || body?.code === '42501' ? 'not_allowed' : 'network' });
  return body;
}

// A small stand-in for Claude's shared db, with the same doc()/onSnapshot()/set()
// shape the app already uses. One poll fetches every document.
export function makeDb(k) {
  const listeners = new Map(); // key -> Set(cb)
  const seen = {}; // key -> server time last delivered
  const localAt = {}; // key -> time of our last write
  let timer = null;
  let busy = false;

  async function poll() {
    if (busy) return;
    busy = true;
    try {
      const all = await rpc('fp_get_state', { k });
      for (const [key, { value, at }] of Object.entries(all || {})) {
        if (seen[key] && at <= seen[key]) continue;
        if (localAt[key] && Date.now() - localAt[key] < 8000) continue; // our own write is still landing
        seen[key] = at;
        for (const cb of listeners.get(key) || []) cb({ exists: true, data: () => ({ value }) });
      }
    } catch {}
    busy = false;
  }
  function start() {
    if (timer) return;
    poll();
    timer = setInterval(() => { if (document.visibilityState === 'visible') poll(); }, 15000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
    window.addEventListener('focus', poll);
  }

  return {
    doc(path) {
      const key = path.replace(/^state\//, '');
      return {
        onSnapshot(cb) {
          if (!listeners.has(key)) listeners.set(key, new Set());
          listeners.get(key).add(cb);
          start();
          if (seen[key]) poll();
          return () => listeners.get(key)?.delete(cb);
        },
        async set({ value }) {
          localAt[key] = Date.now();
          await rpc('fp_set_state', { k, skey: key, svalue: value });
          seen[key] = Date.now();
        },
      };
    },
  };
}

// Turning meals into ingredients. First try the site's own /api/ingredients
// (works when an Anthropic API key is set on Vercel); otherwise queue it for
// Felix's Mac, which answers within a few minutes while it's awake.
export function makeSample(k) {
  return {
    web: true,
    async meals(meals, { signal, onWait } = {}) {
      try {
        const res = await fetch('/api/ingredients', {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', 'x-household': k },
          body: JSON.stringify({ meals }),
        });
        if (res.ok) return await res.json();
        if (res.status !== 501 && res.status !== 404) throw { code: res.status === 403 ? 'not_granted' : 'api' };
      } catch (e) {
        if (e?.name === 'AbortError') throw { code: 'cancelled' };
        if (e?.code && e.code !== 'api') throw e;
      }
      const rid = await rpc('fp_request', { k, meals });
      onWait?.();
      const started = Date.now();
      while (Date.now() - started < 30 * 60 * 1000) {
        await new Promise((r, j) => {
          const t = setTimeout(r, 5000);
          signal?.addEventListener('abort', () => { clearTimeout(t); j({ code: 'cancelled' }); }, { once: true });
        });
        const r = await rpc('fp_get_request', { k, rid }).catch(() => null);
        if (r?.status === 'done') return r.items;
        if (r?.status === 'failed') throw { code: 'worker', message: r.error };
      }
      throw { code: 'timeout' };
    },
  };
}
