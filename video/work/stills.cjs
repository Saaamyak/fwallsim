// node stills.cjs 1.5 4.0 ...  -> stills/s<t>.png (needs the project served on http://localhost:5176)
const { chromium } = require('@playwright/test');
const fs = require('fs');
(async () => {
  const dir = __dirname + '/stills';
  fs.mkdirSync(dir, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:5176/video/work/video.html');
  await p.evaluate(() => window.ready);
  for (const s of process.argv.slice(2)) {
    await p.evaluate((t) => window.render(t), Number(s));
    await p.screenshot({ path: `${dir}/s${s}.png` });
  }
  await b.close();
  if (errs.length) { console.error(errs); process.exit(1); }
  console.log('stills ok');
})();
