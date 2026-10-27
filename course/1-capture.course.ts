// Captures the screenshots used in the class PDFs from the live app (run via `npm run course`).
import type { Locator, Page } from '@playwright/test';
import { test, expect, fresh, freshLogin, go, field, pick, labTab, cli, rowNamed } from '../e2e/helpers';

let dir = 'c00';
const out = (name: string) => `course/img/${dir}/${name}.png`;

/** Red outline + number on an element (removed after the next snap). */
async function mark(page: Page, loc: Locator, n?: number) {
  const b = await loc.first().boundingBox();
  if (!b) return;
  await page.evaluate(
    ({ x, y, w, h, n }) => {
      const d = document.createElement('div');
      d.className = '__mark';
      Object.assign(d.style, { position: 'fixed', left: `${x - 4}px`, top: `${y - 4}px`, width: `${w + 8}px`, height: `${h + 8}px`, border: '3px solid #e8392f', borderRadius: '6px', zIndex: '99999', pointerEvents: 'none', boxShadow: '0 0 0 4px rgba(232,57,47,.18)' });
      if (n) {
        const c = document.createElement('div');
        c.textContent = String(n);
        // keep the number visible when the box touches the window edge
        Object.assign(c.style, { position: 'absolute', left: x < 18 ? '3px' : '-15px', top: y < 18 ? '3px' : '-15px', width: '24px', height: '24px', borderRadius: '50%', background: '#e8392f', color: '#fff', font: 'bold 13px Segoe UI, Arial', display: 'grid', placeItems: 'center' });
        d.appendChild(c);
      }
      document.body.appendChild(d);
    },
    { x: b.x, y: b.y, w: b.width, h: b.height, n },
  );
}

async function snap(page: Page, name: string, target?: Locator) {
  await page.waitForTimeout(150);
  if (target) {
    // Clip to the visible part of the target: element screenshots scroll the page, which
    // would move the target away from the fixed-position markers and make very tall images.
    const b = (await target.first().boundingBox())!;
    const v = page.viewportSize()!;
    const x = Math.max(0, b.x), y = Math.max(0, b.y);
    await page.screenshot({ path: out(name), clip: { x, y, width: Math.min(b.x + b.width, v.width) - x, height: Math.min(b.y + b.height, v.height) - y } });
  }
  else await page.screenshot({ path: out(name) });
  await page.evaluate(() => document.querySelectorAll('.__mark').forEach((e) => e.remove()));
}

/** Tall viewport + hidden dock for full forms. */
async function tall(page: Page, h = 1500) {
  await page.setViewportSize({ width: 1440, height: h });
  if (!(await page.locator('.dock.min').count())) await page.getByTitle('Hide').click();
}
async function normal(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  if (await page.locator('.dock.min').count()) await page.getByTitle('Show').click();
}
async function maxDock(page: Page) {
  if (!(await page.locator('.dock.max').count())) await page.getByTitle('Maximize').click();
}
async function restoreDock(page: Page) {
  if (await page.locator('.dock.max').count()) await page.getByTitle('Restore').click();
}
async function scenario(page: Page, name: string) {
  await page.locator('.dock-tab', { hasText: 'Scenario' }).click();
  await page.locator('.dropdown-menu .mi', { hasText: name }).click();
  await page.waitForTimeout(300);
}
async function dismissToasts(page: Page) {
  await page.evaluate(() => document.querySelectorAll('.toasts').forEach((t) => ((t as HTMLElement).style.display = 'none')));
}
async function quick(page: Page, label: string) {
  await labTab(page, 'Traffic Generator');
  await page.getByText(`▸ ${label}`).click();
}
const content = (page: Page) => page.locator('.content .page');
const dock = (page: Page) => page.locator('.dock');

test('class 01: first login and the GUI', async ({ page, errors }) => {
  dir = 'c01';
  await fresh(page);
  await mark(page, page.getByRole('button', { name: 'Get started' }), 1);
  await snap(page, 'welcome', page.locator('.login-card'));
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByPlaceholder('New Password').fill('Admin123!');
  await page.getByPlaceholder('Confirm Password').fill('Admin123!');
  await mark(page, page.getByPlaceholder('New Password'), 1);
  await mark(page, page.getByPlaceholder('Confirm Password'), 2);
  await mark(page, page.getByRole('button', { name: 'Save and log in' }), 3);
  await snap(page, 'create-password', page.locator('.login-card'));
  await page.getByRole('button', { name: 'Save and log in' }).click();
  await page.locator('.hdr').waitFor();
  await page.locator('.hdr .dropdown button').last().click();
  await page.getByText('Logout').click();
  await mark(page, page.getByPlaceholder('Username'), 1);
  await mark(page, page.getByPlaceholder('Password', { exact: true }), 2);
  await mark(page, page.locator('.login-card select'), 3);
  await mark(page, page.getByRole('button', { name: 'Login' }), 4);
  await snap(page, 'login', page.locator('.login-card'));
  await page.getByPlaceholder('Password', { exact: true }).fill('Admin123!');
  await page.getByRole('button', { name: 'Login' }).click();
  await dismissToasts(page);
  await mark(page, page.locator('.side'), 1);
  await mark(page, page.locator('.widget', { hasText: 'System Information' }), 2);
  await mark(page, page.locator('.widget', { hasText: 'front panel' }), 3);
  await mark(page, page.locator('.dock-bar'), 4);
  await mark(page, page.locator('.hdr .hdr-btn', { hasText: 'Labs' }), 5);
  await snap(page, 'dashboard');
  await mark(page, page.getByTitle('CLI Console'), 1);
  await mark(page, page.locator('.hdr .dropdown').last(), 2);
  await snap(page, 'header', page.locator('.hdr'));
  await labTab(page, 'Traffic Generator');
  await page.locator('.lab-form input').first().fill('192.168.1.99');
  await page.getByRole('button', { name: 'Ping' }).click();
  await mark(page, page.locator('.lab-form select').first(), 1);
  await mark(page, page.locator('.lab-form input').first(), 2);
  await mark(page, page.getByRole('button', { name: 'Ping' }), 3);
  await mark(page, page.getByRole('button', { name: 'Send traffic' }), 4);
  await snap(page, 'traffic-gen', dock(page));
  await page.getByRole('button', { name: 'Send traffic' }).click();
  await maxDock(page);
  await labTab(page, 'Packet Walk');
  await snap(page, 'ping-walk', dock(page));
  await restoreDock(page);
  await cli(page, 'get system status');
  await snap(page, 'cli-status', page.locator('.cli-win'));
  await page.getByTitle('Close').click();
});

test('class 02: interfaces and DHCP', async ({ page, errors }) => {
  dir = 'c02';
  await freshLogin(page);
  await dismissToasts(page);
  await go(page, 'Interfaces');
  await mark(page, rowNamed(page, 'internal'), 1);
  await mark(page, rowNamed(page, 'wan1'), 2);
  await mark(page, rowNamed(page, 'dmz'), 3);
  await snap(page, 'interfaces', content(page));
  await tall(page, 1700);
  await rowNamed(page, 'internal').dblclick();
  await mark(page, field(page, 'Role'), 1);
  await mark(page, field(page, 'IP/Netmask'), 2);
  await mark(page, field(page, 'Administrative Access'), 3);
  await mark(page, page.locator('.section-title', { hasText: 'DHCP Server' }), 4);
  await snap(page, 'edit-internal', content(page));
  await page.getByRole('button', { name: 'Cancel' }).click();
  await rowNamed(page, 'wan1').dblclick();
  await mark(page, field(page, 'Addressing mode'), 1);
  await mark(page, field(page, 'Status'), 2);
  await snap(page, 'edit-wan1', content(page));
  await page.getByRole('button', { name: 'Cancel' }).click();
  await normal(page);
  await go(page, 'Network');
  await mark(page, page.locator('.widget', { hasText: 'DHCP' }).first(), 1);
  await snap(page, 'dhcp-leases', content(page));
  await labTab(page, 'Topology');
  await maxDock(page);
  await snap(page, 'topology', dock(page));
  await restoreDock(page);
  // break DHCP to show APIPA
  await cli(page, 'config system dhcp server', 'edit 2', 'set status disable', 'next', 'end');
  await page.getByTitle('Close').click();
  await labTab(page, 'Traffic Generator');
  await page.locator('.lab-form input').first().fill('192.168.1.99');
  await page.getByRole('button', { name: 'Ping' }).click();
  await page.getByRole('button', { name: 'Send traffic' }).click();
  await maxDock(page);
  await labTab(page, 'Packet Walk');
  await snap(page, 'apipa-walk', dock(page));
});

test('class 03: firewall policy and NAT', async ({ page, errors }) => {
  dir = 'c03';
  await freshLogin(page);
  await dismissToasts(page);
  await go(page, 'Firewall Policy');
  await mark(page, page.locator('tr.row', { hasText: 'Implicit Deny' }), 1);
  await snap(page, 'policy-empty', content(page));
  await quick(page, 'PC1 pings 8.8.8.8');
  await maxDock(page);
  await labTab(page, 'Packet Walk');
  await snap(page, 'denied-walk', dock(page));
  await restoreDock(page);
  await tall(page, 1900);
  await page.getByRole('button', { name: 'Create New' }).click();
  await field(page, 'Name').locator('input').fill('LAN-to-Internet');
  await field(page, 'Incoming Interface').locator('.picker').click();
  await page.locator('.drawer').getByPlaceholder('Search').fill('internal');
  await mark(page, page.locator('.drawer .pick-item', { hasText: 'internal' }).first(), 1);
  await snap(page, 'picker-drawer');
  await page.locator('.drawer .pick-item', { hasText: 'internal' }).first().click();
  await page.locator('.drawer').getByRole('button', { name: 'Close' }).click();
  await pick(page, 'Outgoing Interface', ['wan1']);
  await pick(page, /^Source$/, ['all']);
  await pick(page, /^Destination$/, ['all']);
  await pick(page, /^Service$/, ['ALL']);
  await field(page, 'Log Allowed Traffic').locator('button', { hasText: 'All Sessions' }).click();
  for (const [i, l] of ([[1, 'Name'], [2, 'Incoming Interface'], [3, 'Outgoing Interface'], [4, 'Source'], [5, 'Destination'], [6, 'Schedule'], [7, 'Service'], [8, 'Action'], [9, 'NAT']] as [number, string][]))
    await mark(page, field(page, l), i);
  await snap(page, 'new-policy', content(page));
  await page.getByRole('button', { name: 'OK' }).click();
  await normal(page);
  await dismissToasts(page);
  await quick(page, 'PC1 pings 8.8.8.8');
  await go(page, 'Firewall Policy');
  await mark(page, rowNamed(page, 'LAN-to-Internet'), 1);
  await snap(page, 'policy-list', content(page));
  await maxDock(page);
  await labTab(page, 'Packet Walk');
  await snap(page, 'allowed-walk', dock(page));
  await labTab(page, 'Debug Flow');
  await snap(page, 'debug-flow', dock(page));
  await restoreDock(page);
});

test('class 04: objects', async ({ page, errors }) => {
  dir = 'c04';
  await freshLogin(page);
  await cli(page, 'config firewall policy', 'edit 0', 'set name LAN-to-Internet', 'set srcintf internal', 'set dstintf wan1', 'set srcaddr all', 'set dstaddr all', 'set schedule always', 'set service ALL', 'set action accept', 'set nat enable', 'set logtraffic all', 'next', 'end');
  await page.getByTitle('Close').click();
  await dismissToasts(page);
  await go(page, 'Addresses');
  await snap(page, 'addresses', content(page));
  await tall(page, 1200);
  await page.getByRole('button', { name: 'Create New' }).click();
  await page.locator('.dropdown-menu .mi', { hasText: /^Address$/ }).click();
  await field(page, 'Name').locator('input').fill('LAN-Net');
  await field(page, 'IP/Netmask').locator('input').fill('192.168.1.0/24');
  await mark(page, field(page, 'Name'), 1);
  await mark(page, field(page, 'Type'), 2);
  await mark(page, field(page, 'IP/Netmask'), 3);
  await mark(page, field(page, 'Interface'), 4);
  await snap(page, 'new-address', content(page));
  await page.getByRole('button', { name: 'OK' }).click();
  await go(page, 'Services');
  await page.getByRole('button', { name: 'Create New' }).click();
  await page.locator('.dropdown-menu .mi', { hasText: 'Service Group' }).click();
  await field(page, 'Name').locator('input').fill('Web-Basic');
  await pick(page, 'Members', ['DNS', 'HTTP', 'HTTPS']);
  await mark(page, field(page, 'Members'), 1);
  await snap(page, 'new-service-group', content(page));
  await page.getByRole('button', { name: 'OK' }).click();
  await normal(page);
  await dismissToasts(page);
  await rowNamed(page, 'Web-Basic').first().scrollIntoViewIfNeeded();
  await mark(page, rowNamed(page, 'Web-Basic'), 1);
  await snap(page, 'services', content(page));
  await cli(page, 'config firewall policy', 'edit 1', 'set srcaddr LAN-Net', 'set service Web-Basic', 'next', 'end');
  await page.getByTitle('Close').click();
  await go(page, 'Firewall Policy');
  await mark(page, rowNamed(page, 'LAN-to-Internet'), 1);
  await snap(page, 'policy-objects', content(page));
  await quick(page, 'PC1 browses www.example.com');
  await quick(page, 'PC1 pings 8.8.8.8');
  await snap(page, 'results', dock(page));
});

test('class 05: logs and sessions', async ({ page, errors }) => {
  dir = 'c05';
  await freshLogin(page);
  await scenario(page, 'Small office');
  await dismissToasts(page);
  await go(page, 'Firewall Policy');
  await tall(page, 2000);
  await rowNamed(page, 'LAN-to-Internet').dblclick();
  await mark(page, field(page, 'Log Allowed Traffic'), 1);
  await snap(page, 'logging-options', page.locator('.form-card').locator('.section-title', { hasText: 'Logging Options' }).locator('..'));
  await page.getByRole('button', { name: 'Cancel' }).click();
  await normal(page);
  await dismissToasts(page);
  await page.locator('tr.row', { hasText: 'Implicit Deny' }).click({ button: 'right' });
  await mark(page, page.locator('.ctx-menu'), 1);
  await snap(page, 'implicit-log', content(page));
  await page.keyboard.press('Escape');
  await page.mouse.click(700, 520);
  await quick(page, 'PC1 browses www.example.com');
  await quick(page, 'Attacker tries RDP to PC1 directly');
  await quick(page, 'Internet user visits your website (203.0.113.10:80)');
  await go(page, 'Forward Traffic');
  await page.locator('tr.row').first().click();
  await mark(page, page.locator('.search').last(), 1);
  await mark(page, page.locator('.side-card'), 2);
  await snap(page, 'forward-log', content(page));
  await go(page, 'FortiView Sessions');
  await snap(page, 'sessions', content(page));
  await go(page, 'System Events');
  await snap(page, 'events', content(page));
});

test('class 06: publishing a server with a VIP', async ({ page, errors }) => {
  dir = 'c06';
  await freshLogin(page);
  await cli(page, 'config firewall policy', 'edit 0', 'set name LAN-to-Internet', 'set srcintf internal', 'set dstintf wan1', 'set srcaddr all', 'set dstaddr all', 'set schedule always', 'set service ALL', 'set action accept', 'set nat enable', 'next', 'end');
  await page.getByTitle('Close').click();
  await dismissToasts(page);
  await go(page, 'Virtual IPs');
  await tall(page, 1300);
  await page.getByRole('button', { name: 'Create New' }).click();
  await field(page, 'Name').locator('input').fill('VIP-Web');
  await field(page, 'Interface').locator('select').selectOption('wan1');
  await field(page, 'External IP address/range').locator('input').fill('203.0.113.10');
  await field(page, 'Map to IPv4 address/range').locator('input').fill('10.10.10.10');
  await page.locator('.section-title .toggle', { hasText: 'Port Forwarding' }).click();
  await field(page, 'External service port').locator('input').fill('80');
  await field(page, 'Map to IPv4 port').locator('input').fill('80');
  for (const [i, l] of ([[1, 'Interface'], [2, 'External IP address/range'], [3, 'Map to IPv4 address/range'], [4, 'Protocol'], [5, 'External service port'], [6, 'Map to IPv4 port']] as [number, string][])) await mark(page, field(page, l), i);
  await snap(page, 'vip-form', content(page));
  await page.getByRole('button', { name: 'OK' }).click();
  await go(page, 'Firewall Policy');
  await page.getByRole('button', { name: 'Create New' }).click();
  await field(page, 'Name').locator('input').fill('Web-Inbound');
  await pick(page, 'Incoming Interface', ['wan1']);
  await pick(page, 'Outgoing Interface', ['dmz']);
  await pick(page, /^Source$/, ['all']);
  await pick(page, /^Destination$/, ['VIP-Web']);
  await pick(page, /^Service$/, ['HTTP']);
  await field(page, 'NAT').locator('.toggle').click();
  await mark(page, field(page, 'Incoming Interface'), 1);
  await mark(page, field(page, 'Outgoing Interface'), 2);
  await mark(page, field(page, 'Destination'), 3);
  await mark(page, field(page, 'Service'), 4);
  await mark(page, field(page, 'NAT'), 5);
  await snap(page, 'inbound-policy', content(page));
  await page.getByRole('button', { name: 'OK' }).click();
  await normal(page);
  await dismissToasts(page);
  await snap(page, 'policy-list', content(page));
  await quick(page, 'Internet user visits your website (203.0.113.10:80)');
  await maxDock(page);
  await labTab(page, 'Packet Walk');
  await snap(page, 'dnat-walk', dock(page));
  await restoreDock(page);
  await quick(page, 'Attacker tries SSH to your WAN');
  await snap(page, 'attacker', dock(page));
});

test('class 07: CLI and debug', async ({ page, errors }) => {
  dir = 'c07';
  await freshLogin(page);
  await scenario(page, 'Small office');
  await dismissToasts(page);
  await page.getByTitle('CLI Console').click();
  const input = page.locator('.cli-win input.cli-inline');
  await input.press('?');
  await input.fill('config firewall ');
  await input.press('?');
  await snap(page, 'help', page.locator('.cli-win'));
  await page.getByTitle('Clear').click();
  await cli(page, 'config system interface', 'edit internal', 'show', 'end');
  await snap(page, 'config-mode', page.locator('.cli-win'));
  await page.getByTitle('Clear').click();
  await cli(page, 'show firewall policy 1', 'get system interface physical');
  await snap(page, 'show-get', page.locator('.cli-win'));
  await page.getByTitle('Clear').click();
  await cli(page, 'diagnose debug flow filter addr 8.8.8.8', 'diagnose debug flow show function-name enable', 'diagnose debug flow trace start 10', 'diagnose debug enable');
  await quick(page, 'PC1 pings 8.8.8.8');
  await page.waitForTimeout(300);
  await snap(page, 'debug-flow', page.locator('.cli-win'));
  await page.getByTitle('Clear').click();
  await cli(page, 'diagnose debug disable', 'diagnose sniffer packet any "host 8.8.8.8" 4');
  await quick(page, 'PC1 pings 8.8.8.8');
  await page.locator('.cli-win input.cli-inline').press('Control+c');
  await snap(page, 'sniffer', page.locator('.cli-win'));
  await page.getByTitle('Clear').click();
  await cli(page, 'config firewall policy', 'edit 0', 'set srcintf nosuch', 'abort', 'end');
  await snap(page, 'errors', page.locator('.cli-win'));
});

test('class 08: routing', async ({ page, errors }) => {
  dir = 'c08';
  await freshLogin(page);
  await scenario(page, 'Small office');
  await dismissToasts(page);
  await go(page, 'Network');
  await mark(page, page.locator('.widget', { hasText: 'Static & Dynamic Routing' }), 1);
  await snap(page, 'routing-monitor', content(page));
  await go(page, 'Static Routes');
  await tall(page, 1100);
  await page.getByRole('button', { name: 'Create New' }).click();
  await field(page, 'Destination').locator('input').fill('172.16.0.0/16');
  await field(page, 'Interface').locator('select').selectOption('dmz');
  await field(page, 'Gateway Address').locator('input').fill('10.10.10.254');
  for (const [i, l] of ([[1, 'Destination'], [2, 'Interface'], [3, 'Gateway Address'], [4, 'Administrative Distance'], [5, 'Priority']] as [number, string][])) await mark(page, field(page, l), i);
  await snap(page, 'static-form', content(page));
  await page.getByRole('button', { name: 'OK' }).click();
  await page.getByRole('button', { name: 'Create New' }).click();
  await field(page, 'Destination').locator('input').fill('172.16.0.0/16');
  await field(page, 'Interface').locator('select').selectOption({ label: 'Blackhole' });
  await field(page, 'Administrative Distance').locator('input').fill('254');
  await page.getByRole('button', { name: 'OK' }).click();
  await normal(page);
  await dismissToasts(page);
  await snap(page, 'static-list', content(page));
  await cli(page, 'get router info routing-table all', 'get router info routing-table details 8.8.8.8');
  await snap(page, 'cli-routing', page.locator('.cli-win'));
  await page.getByTitle('Close').click();
  await go(page, 'Policy Routes');
  await tall(page, 1200);
  await page.getByRole('button', { name: 'Create New' }).click();
  await field(page, 'Source address').locator('input').fill('192.168.1.111/32');
  for (const [i, l] of ([[1, 'Incoming interface'], [2, 'Source address'], [3, 'Action'], [4, 'Outgoing interface'], [5, 'Gateway address']] as [number, string][])) await mark(page, field(page, l), i);
  await snap(page, 'policy-route-form', content(page));
  await page.getByRole('button', { name: 'Cancel' }).click();
  await normal(page);
  await quick(page, 'PC1 pings 8.8.8.8');
  await maxDock(page);
  await labTab(page, 'Packet Walk');
  await snap(page, 'route-walk', dock(page));
  expect(true).toBe(true);
});
