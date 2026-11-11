// Builds the link-preview card and icons in public/:
//   og.png (1200x630), apple-touch-icon.png (180x180), favicon.svg.
// Run from the project root: node docs/make-og-image.cjs
// Needs Playwright Chromium (npx playwright install chromium).
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('@playwright/test');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public');
const shot = pathToFileURL(path.join(__dirname, 'img', 'hero.jpg')).href;
const RED = '#c8102e';

// The F mark, same shape as the app's logo.
const markSvg = (size, rounded) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">` +
  `<rect width="32" height="32" rx="${rounded ? 6 : 0}" fill="${RED}"/>` +
  `<path d="M8 9h16v4H13v3h9v4h-9v5H8z" fill="#fff"/></svg>`;

const font = `Lato, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;

const ogHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
  body { font-family: ${font}; color: #f2f6f6; background: #1d2627; position: relative;
    -webkit-font-smoothing: antialiased; }
  .bg { position: absolute; inset: 0;
    background: radial-gradient(900px 560px at 78% 30%, #2b3c3d 0%, #263133 35%, #1d2627 70%); }
  .grid { position: absolute; inset: 0;
    background-image: linear-gradient(rgba(63,191,122,.07) 1px, transparent 1px),
      linear-gradient(90deg, rgba(63,191,122,.07) 1px, transparent 1px);
    background-size: 48px 48px; background-position: -1px -1px; }
  .left { position: absolute; left: 72px; top: 0; bottom: 0; width: 540px;
    display: flex; flex-direction: column; justify-content: center; }
  .brand { display: flex; align-items: center; gap: 18px; margin-bottom: 40px; }
  .brand svg { display: block; filter: drop-shadow(0 6px 16px rgba(200,16,46,.35)); }
  .brand span { font-size: 44px; font-weight: 800; letter-spacing: -0.5px; }
  h1 { margin: 0 0 26px; font-size: 58px; line-height: 1.08; font-weight: 800; letter-spacing: -1px; }
  h1 em { font-style: normal; color: #3fbf7a; }
  .sub { font-size: 24px; line-height: 1.4; color: #c4d3d3; margin-bottom: 44px; }
  .sub b { color: #3fbf7a; font-weight: 400; padding: 0 4px; }
  .url { font-size: 22px; color: #8fa5a5; letter-spacing: .3px; }
  .card { position: absolute; left: 660px; top: 92px; width: 640px; height: 470px;
    border-radius: 16px; overflow: hidden; background: #f2f4f4;
    box-shadow: 0 30px 70px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08); }
  .card img { position: absolute; left: 0; top: 0; width: 1290px; height: auto; }
</style></head><body>
  <div class="bg"></div><div class="grid"></div>
  <div class="left">
    <div class="brand">${markSvg(64, true)}<span>FWallSim</span></div>
    <h1>Learn firewalls <em>hands-on</em>, in your browser</h1>
    <div class="sub">FortiGate-style GUI and CLI<br>Packet Walk<b>·</b>20 guided labs</div>
    <div class="url">fwallsim.vercel.app</div>
  </div>
  <div class="card"><img src="${shot}" alt=""></div>
</body></html>`;

const iconHtml = `<!doctype html><html><head><style>
  html, body { margin: 0; width: 180px; height: 180px; overflow: hidden; background: ${RED}; }
  svg { display: block; }
</style></head><body>${markSvg(180, false)}</body></html>`;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'favicon.svg'), markSvg(32, true).replace(/ width="32" height="32"/, '') + '\n');

  const tmp = path.join(__dirname, '.og-tmp.html');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    // Loaded from a file next to this script so the file:// screenshot is allowed.
    fs.writeFileSync(tmp, ogHtml);
    await page.goto(pathToFileURL(tmp).href);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, 'og.png') });

    await page.setViewportSize({ width: 180, height: 180 });
    await page.setContent(iconHtml);
    await page.screenshot({ path: path.join(out, 'apple-touch-icon.png') });
  } finally {
    await browser.close();
    fs.rmSync(tmp, { force: true });
  }
  for (const f of ['og.png', 'apple-touch-icon.png', 'favicon.svg']) {
    console.log(`public/${f}  ${(fs.statSync(path.join(out, f)).size / 1024).toFixed(0)} KB`);
  }
})();
