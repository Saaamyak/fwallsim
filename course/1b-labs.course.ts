// Screenshots for the classes built from labs that have no hand-made capture in 1-capture.course.ts.
// Each lab is started, photographed, solved with the reference solution (tests/solutions.ts,
// loaded in the page through Vite) and photographed again.
import type { Page } from '@playwright/test';
import { test, freshLogin, labTab } from '../e2e/helpers';

interface Shot {
  id: string;
  pages: string[]; // menu pages worth showing once solved
  traffic?: { srcHost: string; dst: string; proto: 'tcp' | 'udp' | 'icmp'; dport: number };
}

const LABS: Shot[] = [
  { id: 'l6-order', pages: ['pol-policy'], traffic: { srcHost: 'pc2', dst: 'www.youtube.com', proto: 'tcp', dport: 443 } },
  { id: 'l8-harden', pages: ['sys-profiles', 'sys-admins', 'pol-localin'] },
  { id: 'l9-ldap', pages: ['usr-ldap', 'usr-grp', 'dash-users'], traffic: { srcHost: 'pc1', dst: 'www.example.com', proto: 'tcp', dport: 443 } },
  { id: 'l10-ipsec', pages: ['vpn-ipsec', 'net-static', 'pol-policy'], traffic: { srcHost: 'pc1', dst: '10.20.0.10', proto: 'icmp', dport: 0 } },
  { id: 'l11-sslvpn', pages: ['vpn-sslsettings', 'pol-policy'], traffic: { srcHost: 'laptop', dst: '192.168.1.110', proto: 'tcp', dport: 3389 } },
  { id: 'l12-sdwan', pages: ['net-sdwan', 'net-static'], traffic: { srcHost: 'pc1', dst: '8.8.8.8', proto: 'icmp', dport: 0 } },
  { id: 'c1-no-internet', pages: ['pol-policy'], traffic: { srcHost: 'pc1', dst: '8.8.8.8', proto: 'icmp', dport: 0 } },
  { id: 'c2-dns', pages: ['pol-policy'], traffic: { srcHost: 'pc1', dst: 'www.example.com', proto: 'tcp', dport: 443 } },
  { id: 'c3-website', pages: ['pol-vip'], traffic: { srcHost: 'user', dst: '203.0.113.10', proto: 'tcp', dport: 80 } },
  { id: 'c4-dhcp', pages: ['net-interfaces', 'dash-network'], traffic: { srcHost: 'pc2', dst: '8.8.8.8', proto: 'icmp', dport: 0 } },
  { id: 'c5-branch', pages: ['vpn-ipsec', 'net-static'], traffic: { srcHost: 'pc1', dst: '10.20.0.10', proto: 'icmp', dport: 0 } },
  { id: 'c6-failover', pages: ['net-sdwan'], traffic: { srcHost: 'pc1', dst: '8.8.8.8', proto: 'icmp', dport: 0 } },
];

const STORE = '/src/store.ts';
const SOLUTIONS = '/tests/solutions.ts';

async function app(page: Page, fn: string, ...args: unknown[]) {
  await page.evaluate(
    async ({ url, fn, args }) => {
      const m = await import(/* @vite-ignore */ url);
      m[fn](...args);
    },
    { url: fn === 'solve' ? SOLUTIONS : STORE, fn, args },
  );
  await page.waitForTimeout(400);
}

async function outline(page: Page, selector: string) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) el.style.outline = '3px solid #e8392f';
  }, selector);
}

for (const [n, s] of LABS.entries()) {
  test(`lab shots ${String(n + 1).padStart(2, '0')}: ${s.id}`, async ({ page }) => {
    const out = (name: string) => `course/img/${s.id}/${name}.png`;
    const hideToasts = () => page.evaluate(() => document.querySelectorAll('.toasts').forEach((t) => ((t as HTMLElement).style.display = 'none')));
    await freshLogin(page);
    await app(page, 'startLab', s.id);
    await hideToasts();
    await outline(page, '.lab-guide');
    await page.screenshot({ path: out('1-lab-started') });
    await outline(page, '.nothing');
    await page.evaluate(() => ((document.querySelector('.lab-guide') as HTMLElement | null)?.style.setProperty('outline', 'none')));

    const walk = async (name: string) => {
      if (!s.traffic) return;
      await app(page, 'sendTraffic', s.traffic);
      await labTab(page, 'Packet Walk');
      await page.waitForTimeout(200);
      await page.locator('.dock').screenshot({ path: out(name) });
    };
    await walk('2-packet-walk-before');

    await app(page, 'solve', s.id);
    await page.getByTitle('Re-check now').click();
    await page.waitForTimeout(300);
    await hideToasts();
    await outline(page, '.lab-guide');
    await page.screenshot({ path: out('3-lab-solved') });
    await page.evaluate(() => ((document.querySelector('.lab-guide') as HTMLElement | null)?.style.setProperty('outline', 'none')));

    // hide the Lab dock so it does not cover the bottom of the page screenshots
    if (!(await page.locator('.dock.min').count())) await page.getByTitle('Hide').click();
    for (const [i, p] of s.pages.entries()) {
      await app(page, 'navigate', p);
      await hideToasts();
      const title = ((await page.locator('.content .page-title').first().textContent()) ?? p).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      await page.locator('.content .page').screenshot({ path: out(`${4 + i}-${title}`) });
    }
    await page.getByTitle('Show').click();
    await walk('9-packet-walk-after');
  });
}
