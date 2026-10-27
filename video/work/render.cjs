// Renders every frame of video.html (each frame is a pure function of time) to frames/.
const { chromium } = require('@playwright/test');
const fs = require('fs');
const FPS = 30, DUR = 22.9;
(async () => {
  const dir = __dirname + '/frames';
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:5176/video/work/video.html');
  await p.evaluate(() => window.ready);
  const total = Math.round(FPS * DUR);
  for (let f = 0; f < total; f++) {
    await p.evaluate((t) => window.render(t), f / FPS);
    await p.screenshot({ path: `${dir}/f${String(f).padStart(5, '0')}.png` });
    if (f % 150 === 0) console.log('frame', f, '/', total);
  }
  await b.close();
  if (errs.length) { console.error(errs); process.exit(1); }
  console.log('frames', total);
})();
