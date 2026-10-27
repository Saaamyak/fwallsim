import { test, expect, fresh, freshLogin, go, login, cli, rowNamed, toastText, field } from './helpers';

test('backup then restore through the GUI brings the configuration back after reboot', async ({ page, errors }) => {
  await freshLogin(page);
  await cli(page, 'config system global', 'set hostname BACKUP-TEST', 'end');
  await page.getByTitle('Close').click();
  await page.locator('.hdr .dropdown button').last().click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.dropdown-menu .mi', { hasText: 'Backup' }).click()]);
  const file = await dl.path();
  await cli(page, 'config system global', 'set hostname CHANGED', 'end');
  await page.getByTitle('Close').click();
  await expect(page.locator('.hdr .brand .hostname')).toHaveText('CHANGED');
  await page.locator('.hdr .dropdown button').last().click();
  await page.locator('.dropdown-menu .mi', { hasText: 'Restore' }).click();
  await page.locator('.modal input[type=file]').setInputFiles(file!);
  await expect(page.getByPlaceholder('Username')).toBeVisible({ timeout: 10_000 });
  await login(page, 'admin', 'Admin123!');
  await expect(page.locator('.hdr .brand .hostname')).toHaveText('BACKUP-TEST');
});

test('restoring a file that is not a config shows an error and changes nothing', async ({ page, errors }) => {
  await freshLogin(page);
  await page.locator('.hdr .dropdown button').last().click();
  await page.locator('.dropdown-menu .mi', { hasText: 'Restore' }).click();
  await page.locator('.modal input[type=file]').setInputFiles({ name: 'junk.conf', mimeType: 'text/plain', buffer: Buffer.from('hello world\n') });
  await expect(page.locator('.modal .err-text')).toContainText('unknown command');
  await expect(page.locator('.hdr .brand .hostname')).toHaveText('FWS60F');
});

test('idle timeout logs the admin out', async ({ page, errors }) => {
  await page.clock.install();
  await freshLogin(page);
  await page.clock.fastForward('06:00'); // default admintimeout is 5 minutes
  await expect(page.getByPlaceholder('Username')).toBeVisible();
});

test('factory reset from Settings wipes the config', async ({ page, errors }) => {
  await freshLogin(page);
  await cli(page, 'config system global', 'set hostname TO-BE-WIPED', 'end');
  await page.getByTitle('Close').click();
  await go(page, 'Settings');
  await page.getByRole('button', { name: 'Factory reset…' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Reset' }).click();
  // no welcome again, straight to creating a new admin password
  await expect(page.getByText('Create your admin password')).toBeVisible();
  await login(page);
  await expect(page.locator('.hdr .brand .hostname')).toHaveText('FWS60F');
});

test('objects in use, built-ins and physical interfaces cannot be deleted', async ({ page, errors }) => {
  await freshLogin(page);
  await page.locator('.dock-tab', { hasText: 'Scenario' }).click();
  await page.locator('.dropdown-menu .mi', { hasText: 'Small office' }).click();
  await go(page, 'Virtual IPs');
  await rowNamed(page, 'VIP-WebServer-HTTP').click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => toastText(page)).toContain('cannot be deleted');
  await go(page, 'Schedules');
  await rowNamed(page, 'always').click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => toastText(page)).toContain('built in');
  await go(page, 'Interfaces');
  await page.locator('tr.row', { hasText: 'wan2' }).first().click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => toastText(page)).toContain('cannot be deleted');
  // duplicate name rejected
  await go(page, 'Addresses');
  await page.getByRole('button', { name: 'Create New' }).click();
  await page.locator('.dropdown-menu .mi', { hasText: /^Address$/ }).click();
  await field(page, 'Name').locator('input').fill('LAN-Subnet');
  await field(page, 'IP/Netmask').locator('input').fill('10.9.9.0/24');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByText('already exists')).toBeVisible();
});

test('reload keeps you logged in and on the same page; a new browser session needs login', async ({ page, browser, errors }) => {
  await freshLogin(page);
  await go(page, 'Static Routes');
  await page.reload();
  await expect(page.locator('.page-title', { hasText: 'Static Routes' })).toBeVisible();
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto('/');
  // another browser has its own, factory-fresh simulator
  await expect(p2.getByRole('button', { name: 'Get started' })).toBeVisible();
  await other.close();
  await fresh(page);
});

test('a settings page reloads after a CLI change instead of showing (and re-applying) stale values', async ({ page, errors }) => {
  await freshLogin(page);
  await go(page, 'SSL-VPN Settings');
  await expect(field(page, 'Listen on Port').locator('input')).toHaveValue('443');
  await cli(page, 'config vpn ssl settings', 'set port 10443', 'end');
  await page.getByTitle('Close').click();
  await expect(field(page, 'Listen on Port').locator('input')).toHaveValue('10443');
  await go(page, 'Settings');
  await cli(page, 'config system global', 'set admintimeout 25', 'end');
  await page.getByTitle('Close').click();
  await expect(field(page, 'Idle timeout (minutes)').locator('input')).toHaveValue('25');
});
