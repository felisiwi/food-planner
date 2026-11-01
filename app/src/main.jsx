import { createRoot } from 'react-dom/client';
import './styles.css';
import { householdKey, makeDb, makeSample, rpc } from './web.js';
import { setData } from './data.js';

// Inside Claude the price data is embedded in the page. As a website it's
// loaded from /data.json, with private bits (receipt prices) from Supabase.
async function boot() {
  if (!window.__FP_DATA__) {
    const k = householdKey();
    const [data, receipts] = await Promise.all([
      fetch('/data.json', { cache: 'no-cache' }).then((r) => r.json()),
      k ? rpc('fp_get_receipts', { k }).catch(() => []) : [],
    ]);
    data.receipts = receipts || [];
    setData(data);
    window.__FP_WEB__ = { db: k ? makeDb(k) : null, sample: k ? makeSample(k) : null, signedIn: !!k };
  }
  const { default: App } = await import('./App.jsx');
  createRoot(document.getElementById('root')).render(<App />);
}

boot().catch(() => {
  document.getElementById('root').textContent = 'Couldn’t load prices. Check your connection and reload.';
});
