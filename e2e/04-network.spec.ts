import { test, expect, freshLogin, go, field, labTab, rowNamed, toastText } from './helpers';

test('interface edit: overlap rejected, LAN renumber + DHCP follow, PCs get new leases', async ({ page, errors }) => {
  await freshLogin(page);
  await go(page, 'Interfaces');
  await rowNamed(page, 'internal').dblclick();
  await field(page, 'IP/Netmask').locator('input').fill('10.10.10.5/24');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByText('IP address is in same subnet as the others')).toBeVisible();
  await field(page, 'IP/Netmask').locator('input').fill('192.168.10.1/24');
  const range = field(page, 'Address range').locator('input');
  await range.nth(0).fill('192.168.10.100');
  await range.nth(1).fill('192.168.10.200');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(rowNamed(page, 'internal')).toContainText('192.168.10.1');
  await go(page, 'Network');
  await expect(page.locator('tr.row', { hasText: 'PC1-Admin' })).toContainText('192.168.10.100');
  await expect(page.locator('tr.row', { hasText: '192.168.10.0/24' })).toBeVisible();
});

test('static route and DNS forms validate and save; config survives reload', async ({ page, errors }) => {
  await freshLogin(page);
  await go(page, 'Static Routes');
  await page.getByRole('button', { name: 'Create New' }).click();
  await field(page, 'Destination').locator('input').fill('172.16.0.0/16');
  await field(page, 'Interface').locator('select').selectOption('wan1');
  await field(page, 'Gateway Address').locator('input').fill('not-an-ip');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByText('Enter a valid gateway address.')).toBeVisible();
  await field(page, 'Gateway Address').locator('input').fill('203.0.113.1');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('tr.row', { hasText: '172.16.0.0/16' })).toContainText('Active');

  await go(page, 'DNS');
  await page.getByRole('button', { name: 'Specify' }).click();
  await field(page, 'Primary DNS server').locator('input').fill('8.8.8.8');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => toastText(page)).toContain('DNS settings applied');

  await page.reload();
  await go(page, 'Static Routes');
  await expect(page.locator('tr.row', { hasText: '172.16.0.0/16' })).toBeVisible();
  await go(page, 'DNS');
  await expect(field(page, 'Primary DNS server').locator('input')).toHaveValue('8.8.8.8');
});

test('backup download produces a FortiOS config file', async ({ page, errors }) => {
  await freshLogin(page);
  await page.locator('.hdr .dropdown button').last().click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.dropdown-menu .mi', { hasText: 'Backup' }).click()]);
  const path = await dl.path();
  const fs = await import('fs');
  const txt = fs.readFileSync(path!, 'utf8');
  expect(txt).toContain('#config-version=FWS60F');
  expect(txt).toContain('config system interface');
  expect(dl.suggestedFilename()).toMatch(/^FWS60F_\d{8}_\d{4}\.conf$/);
  await labTab(page, 'Traffic Generator');
});
