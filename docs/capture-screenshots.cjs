// Clean screenshots of the real app for the README (docs/img/*.jpg).
// Usage (from the project root):  FWALLSIM_E2E=1 npx vite --port 5175 --strictPort &   then   node docs/capture-screenshots.cjs
const { chromium } = require('@playwright/test');
const OUT = __dirname + '/img/';
const BASE = 'http://localhost:5175';
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const app = (url, fn, ...args) => page.evaluate(async ({ url, fn, args }) => { const m = await import(url); return m[fn](...args); }, { url, fn, args }).then(() => page.waitForTimeout(400));
  const hideToasts = () => page.evaluate(() => document.querySelectorAll('.toasts').forEach((t) => (t.style.display = 'none')));
  const shot = async (name, el) => { await hideToasts(); await (el ?? page).screenshot({ path: OUT + name + '.jpg', type: 'jpeg', quality: 88 }); };

  await page.goto(BASE);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.locator('.login-card').waitFor();
  await shot('welcome');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByPlaceholder('New Password').fill('Admin123!');
  await page.getByPlaceholder('Confirm Password').fill('Admin123!');
  await page.getByRole('button', { name: 'Save and log in' }).click();
  await page.locator('.hdr').waitFor();

  // Lab catalogue
  await app('/src/store.ts', 'setUi', { dock: 'min' });
  await app('/src/store.ts', 'navigate', 'training', null);
  await shot('labs');

  // Hero: Lab 2 solved, guide all green, Packet Walk of the ping in the dock
  await app('/src/store.ts', 'startLab', 'l2-first-policy');
  await app('/tests/solutions.ts', 'solve', 'l2-first-policy');
  await app('/src/store.ts', 'sendTraffic', { srcHost: 'pc1', dst: '8.8.8.8', proto: 'icmp', dport: 0 });
  await page.getByTitle('Re-check now').click();
  await app('/src/store.ts', 'navigate', 'pol-policy', null);
  await app('/src/store.ts', 'setUi', { dock: 'normal', dockTab: 'walk' });
  await page.setViewportSize({ width: 1720, height: 1000 }); // wide enough for the policy table beside the guide
  await page.waitForTimeout(500);
  await shot('hero');
  await page.setViewportSize({ width: 1440, height: 900 });

  // Packet Walk, full height
  await app('/src/store.ts', 'setUi', { dock: 'max', dockTab: 'walk' });
  await shot('packet-walk', page.locator('.dock'));
  await app('/src/store.ts', 'setUi', { dock: 'normal', dockTab: 'traffic' });

  // CLI: live debug flow
  await page.getByTitle('Close').first().click().catch(() => {});
  await page.getByTitle('CLI Console').click();
  const input = page.locator('.cli-win input.cli-inline');
  for (const l of ['diagnose debug flow filter addr 8.8.8.8', 'diagnose debug flow show function-name enable', 'diagnose debug flow trace start 10', 'diagnose debug enable']) { await input.fill(l); await input.press('Enter'); }
  await app('/src/store.ts', 'sendTraffic', { srcHost: 'pc1', dst: '8.8.8.8', proto: 'icmp', dport: 0 });
  await page.waitForTimeout(300);
  await shot('cli', page.locator('.cli-win'));

  await b.close();
  if (errors.length) { console.error('Browser errors:', errors); process.exit(1); }
  console.log('Saved to docs/img: welcome, labs, hero, packet-walk, cli');
})();
