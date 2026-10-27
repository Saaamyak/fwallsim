// Captures real FWallSim UI for the launch video: screenshots plus the real HTML of the
// traffic results, Packet Walk, Lab Guide and CLI (rendered later with the app's own styles.css).
// Needs the app on http://localhost:5175 (FWALLSIM_E2E=1 npx vite --port 5175 --strictPort).
const { chromium } = require('@playwright/test');
const fs = require('fs');
const OUT = __dirname + '/shots/';
const BASE = 'http://localhost:5175';
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const app = (url, fn, ...args) => page.evaluate(async ({ url, fn, args }) => { const m = await import(url); return m[fn](...args); }, { url, fn, args }).then(() => page.waitForTimeout(350));
  const store = (fn, ...args) => app('/src/store.ts', fn, ...args);
  const hideToasts = () => page.evaluate(() => document.querySelectorAll('.toasts').forEach((t) => (t.style.display = 'none')));
  const html = (sel) => page.locator(sel).first().evaluate((e) => e.outerHTML);
  const rect = (loc) => loc.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const ping = () => store('sendTraffic', { srcHost: 'pc1', dst: '8.8.8.8', proto: 'icmp', dport: 0 });
  const parts = {};

  await page.goto(BASE);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.locator('.login-card').waitFor();
  await page.screenshot({ path: OUT + 'welcome.png' });
  parts.welcomeCard = await rect(page.locator('.login-card'));
  parts.getStarted = await rect(page.getByRole('button', { name: 'Get started' }));
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByPlaceholder('New Password').fill('Video123!');
  await page.getByPlaceholder('Confirm Password').fill('Video123!');
  await page.getByRole('button', { name: 'Save and log in' }).click();
  await page.locator('.hdr').waitFor();
  parts.theme = await page.evaluate(() => document.documentElement.dataset.theme);

  // Hook: a factory unit blocks PC1's ping
  await store('setUi', { dock: 'normal', dockTab: 'traffic' });
  await ping();
  parts.denied = await html('.dock .result');

  // Lab Guide before
  await store('startLab', 'l2-first-policy');
  await hideToasts();
  parts.guide0 = await html('.lab-guide');

  // The policy, as built in the lab (no guide on screen for the form shot)
  await store('exitLab');
  await app('/tests/solutions.ts', 'solve', 'l2-first-policy');
  await store('setUi', { dock: 'min' });
  await store('navigate', 'pol-policy', '1');
  await hideToasts();
  await page.setViewportSize({ width: 1920, height: 1800 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + 'policy-edit.png' });
  const field = (label) => page.locator('.field', { has: page.locator('label', { hasText: new RegExp(`^\\s*${label}\\s*$`) }) }).first();
  parts.action = await rect(field('Action'));
  parts.nat = await rect(field('NAT'));
  parts.accept = await rect(field('Action').getByText('ACCEPT', { exact: true }).first());
  parts.natToggle = await rect(field('NAT').locator('.toggle, input, button').first());
  await page.setViewportSize({ width: 1920, height: 1080 });

  // Allowed result + Packet Walk of the same ping
  await store('navigate', 'pol-policy', null);
  await store('clearHistory');
  await store('setUi', { dock: 'normal', dockTab: 'traffic' });
  await ping();
  parts.allowed = await html('.dock .result');
  await store('setUi', { dock: 'max', dockTab: 'walk' });
  parts.walk = await html('.dock .walk');

  // CLI: the debug flow of one ping
  await store('setUi', { dock: 'normal', dockTab: 'traffic' });
  await page.getByTitle('CLI Console').click();
  const input = page.locator('.cli-win input.cli-inline');
  await input.fill('clear'); await input.press('Control+l');
  for (const l of ['diagnose debug flow filter addr 8.8.8.8', 'diagnose debug flow trace start 10', 'diagnose debug enable']) { await input.fill(l); await input.press('Enter'); }
  await ping();
  parts.cliBar = await html('.cli-win .bar');
  parts.cliText = await page.locator('.cli-win .console').first().innerText();
  await page.getByTitle('Close').first().click().catch(() => {});

  // Lab Guide after: the same lab, solved
  await store('startLab', 'l2-first-policy');
  await app('/tests/solutions.ts', 'solve', 'l2-first-policy');
  await ping();
  await page.getByTitle('Re-check now').click();
  await page.waitForTimeout(400);
  parts.guide4 = await html('.lab-guide');

  fs.writeFileSync(OUT + 'parts.json', JSON.stringify(parts, null, 1));
  await b.close();
  if (errors.length) { console.error('Browser errors:', errors); process.exit(1); }
  console.log('captured', Object.keys(parts).join(', '));
})();
