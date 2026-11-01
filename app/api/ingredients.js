// Meals -> ingredients for the website, using the Anthropic API.
// Only active when ANTHROPIC_API_KEY is set on Vercel; otherwise answers 501 and
// the app queues the request for the Mac instead. Requires the household key.
import { ingredientsPrompt, cleanPlan } from '../../lib/ingredients.mjs';

const SUPABASE_URL = 'https://lkvedgtzgxiykcqemqkk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_naUK87EG4MbaLgl-Io6YbA_Yf7a3Wgy';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(501).json({ error: 'not configured' });

  const k = req.headers['x-household'];
  const ok = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fp_get_request`, {
    method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ k: String(k || ''), rid: 0 }),
  }).then((r) => r.ok, () => false);
  if (!ok) return res.status(403).json({ error: 'not allowed' });

  const meals = String(req.body?.meals || '').slice(0, 4000);
  if (!meals.trim()) return res.status(400).json({ error: 'no meals' });

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content: ingredientsPrompt(meals) }],
    }),
  });
  if (!r.ok) return res.status(502).json({ error: 'model error ' + r.status });
  const body = await r.json();
  try {
    res.status(200).json(cleanPlan(body.content?.map((c) => c.text || '').join('') || ''));
  } catch {
    res.status(502).json({ error: 'invalid answer' });
  }
}
