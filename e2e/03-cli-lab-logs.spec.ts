import { test, expect, freshLogin, go, labTab, cli } from './helpers';

test('CLI: tab completion, ? help, config mode changes the GUI, errors are reported', async ({ page, errors }) => {
  await freshLogin(page);
  await page.getByTitle('CLI Console').click();
  const input = page.locator('.cli-win input.cli-inline');
  await input.fill('sh');
  await input.press('Tab');
  await expect(input).toHaveValue('show ');
  await input.fill('');
  await input.press('?');
  const out = page.locator('.cli-win .console');
  await expect(out).toContainText('Configure object.');
  const console1 = await cli(page, 'conf sys glo', 'set hostname LAB-FGT', 'end');
  await expect(page.locator('.hdr .brand .hostname')).toHaveText('LAB-FGT');
  await expect(console1).toContainText('LAB-FGT #');
  await cli(page, 'config firewall policy', 'edit 0', 'set srcintf nosuch');
  await expect(out).toContainText('entry not found in datasource');
  await cli(page, 'abort', 'end', 'get system status');
  await expect(out).toContainText('Hostname: LAB-FGT');
});

test('CLI: live debug flow and sniffer react to Lab traffic, Ctrl+C stops the sniffer', async ({ page, errors }) => {
  await freshLogin(page);
  const out = await cli(page, 'diag debug flow filter addr 8.8.8.8', 'diag debug flow trace start 5', 'diag debug enable');
  await labTab(page, 'Traffic Generator');
  await page.getByText('▸ PC1 pings 8.8.8.8').click();
  await expect(out).toContainText('received a packet(proto=1, 192.168.1.110');
  await expect(out).toContainText('Denied by forward policy check (policy 0)');
  await cli(page, 'diag debug disable', 'diag sniffer packet any "host 8.8.8.8" 4');
  await expect(out).toContainText('interfaces=[any]');
  await page.getByText('▸ PC1 pings 8.8.8.8').click();
  await expect(out).toContainText('internal in 192.168.1.110 -> 8.8.8.8: icmp: echo request');
  await page.locator('.cli-win input.cli-inline').press('Control+c');
  await expect(out).toContainText('packets received by filter');
});

test('Lab dock: every tab opens, topology selects the source, dock resizes', async ({ page, errors }) => {
  await freshLogin(page);
  for (const t of ['Traffic Generator', 'Topology', 'Packet Walk', 'Debug Flow', 'Users', 'VPN', 'WAN', 'Mgmt']) {
    await labTab(page, t);
    await expect(page.locator('.dock-body')).toBeVisible();
  }
  await labTab(page, 'Topology');
  await page.locator('svg.topo text', { hasText: 'PC2-Sales' }).click();
  await expect(page.locator('.lab-form select').first()).toHaveValue('pc2');
  await page.getByTitle('Maximize').click();
  await expect(page.locator('.dock')).toHaveClass(/max/);
  await page.getByTitle('Restore').click();
  await page.getByTitle('Hide').click();
  await expect(page.locator('.dock')).toHaveClass(/min/);
});

test('Scenario load + logs: forward log entries appear with details and raw log', async ({ page, errors }) => {
  await freshLogin(page);
  await page.locator('.dock-tab', { hasText: 'Scenario' }).click();
  await page.locator('.dropdown-menu .mi', { hasText: 'Small office' }).click();
  await labTab(page, 'Traffic Generator');
  await page.getByText('▸ PC1 browses www.example.com').click();
  await expect(page.locator('.result').first()).toContainText('delivered and answered');
  await go(page, 'Forward Traffic');
  const row = page.locator('tr.row').first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator('.side-card')).toContainText('Log Details');
  await expect(page.locator('.side-card .console')).toContainText('type="traffic"');
  await go(page, 'FortiView Sessions');
  await expect(page.locator('tr.row').first()).toBeVisible();
  await go(page, 'System Events');
  await expect(page.locator('tr.row', { hasText: 'Loaded lab scenario' })).toBeVisible();
});
