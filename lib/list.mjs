// Shopping list: one item per line, "2 x" for quantity, "#" for comments.
export function parseList(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(\d+)\s*x\s+(.+)$/i);
      return m ? { qty: Number(m[1]), term: m[2].trim() } : { qty: 1, term: l };
    });
}

// Manual prices (prices/lidl.csv): term,name,price,date
// Fills gaps for items a store doesn't list online. Simple CSV, no quoted commas.
export function parseCsv(text) {
  const [head, ...rows] = text.trim().split('\n').filter((l) => l && !l.startsWith('#'));
  if (!head) return [];
  const cols = head.split(',').map((c) => c.trim());
  return rows.map((r) => {
    const v = r.split(',').map((c) => c.trim());
    return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? '']));
  });
}
