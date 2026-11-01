import { chromium } from 'playwright';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#1d2a24"/>
<g fill="none" stroke="#8fe0b7" stroke-width="30" stroke-linecap="round" stroke-linejoin="round">
<path d="M136 220h240l-28 150a28 28 0 0 1-27 22H191a28 28 0 0 1-27-22z"/>
<path d="M190 220l46-86M322 220l-46-86"/>
<path d="M216 270v70M296 270v70"/>
</g></svg>`;
const b = await chromium.launch(); const p = await b.newPage();
for (const s of [512, 192, 180]) {
  await p.setViewportSize({ width: s, height: s });
  await p.setContent(`<style>body{margin:0}</style>${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}`);
  await p.screenshot({ path: `public/${s === 180 ? 'apple-touch-icon' : 'icon-' + s}.png` });
}
await b.close();
