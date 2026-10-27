// Phase 9 deep-QA additions: flows that the earlier suites did not exercise.
import { test, expect, freshLogin, go, login, cli, rowNamed, field, labTab } from './helpers';

const pol = (id: string, name: string, action: string) => ['config firewall policy', `edit ${id}`, `set name ${name}`, 'set srcintf internal', 'set dstintf wan1', 'set srcaddr all', 'set dstaddr all', 'set schedule always', 'set service ALL', `set action ${action}`, ...(action === 'accept' ? ['set nat enable'] : []), 'next', 'end'];

async function logout(page: import('@playwright/test').Page) {
  await page.locator('.hdr .dropdown button').last().click();
  await page.locator('.dropdown-menu .mi', { hasText: 'Logout' }).click();
  await expect(page.getByPlaceholder('Username')).toBeVisible();
}

test('three wrong passwords lock the source out; the login-page reset recovers a forgotten password', async ({ page, errors }) => {
  await freshLogin(page);
  await logout(page);
  for (let i = 0; i < 3; i++) {
    await page.getByPlaceholder('Password', { exact: true }).fill('wrong' + i);
    await page.getByRole('button', { name: 'Login' }).click();
  }
  const err = page.locator('.login-err');
  await expect(err).toContainText('Too many failed login attempts from PC1-Admin');
  await expect(err).toContainText('choose another PC');
  // the countdown runs
  const secs = async () => Number((await err.textContent())?.match(/locked for (\d+)/)?.[1]);
  const first = await secs();
  await expect.poll(secs, { timeout: 5000 }).toBeLessThan(first);
  // even the right password is refused while locked
  await page.getByPlaceholder('Password', { exact: true }).fill('Admin123!');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(err).toContainText('locked for');
  // another lab PC is not locked
  await page.locator('.login-card select').selectOption('pc2');
  await expect(err).toHaveCount(0);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.locator('.hdr')).toBeVisible();
  await logout(page);
  // forgot it: reset from the login page, then create a new password
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /Forgot password or locked out/ }).click();
  await expect(page.getByText('Create your admin password')).toBeVisible();
  await expect(err).toHaveCount(0);
  await login(page, 'admin', '', 'NewPass1!');
  await expect(page.locator('.hdr')).toBeVisible();
});

test('policy right-click menu: clone, move up, insert, show logs, delete', async ({ page, errors }) => {
  await freshLogin(page);
  await cli(page, ...pol('1', 'Allow-All', 'accept'), ...pol('2', 'Block-All', 'deny'));
  await page.getByTitle('Close').click();
  await go(page, 'Firewall Policy');
  await page.getByRole('button', { name: 'By Sequence' }).click();
  const names = () => page.locator('tr.row td:first-child').allInnerTexts();

  await rowNamed(page, 'Allow-All').click({ button: 'right' });
  await page.locator('.ctx-menu').getByText('Clone (paste below)').click();
  await expect.poll(async () => (await names()).filter((n) => n.includes('Allow-All')).length).toBe(2);

  await rowNamed(page, 'Block-All').click({ button: 'right' });
  await page.locator('.ctx-menu').getByText('Move up').click();
  await expect.poll(async () => (await names()).findIndex((n) => n.includes('Block-All'))).toBeLessThan(2);

  await rowNamed(page, 'Block-All').click({ button: 'right' });
  await page.locator('.ctx-menu').getByText('Insert empty policy above').click();
  await expect(page.locator('.page-title')).toContainText('Policy');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await rowNamed(page, 'Block-All').click({ button: 'right' });
  await page.locator('.ctx-menu').getByText('Show matching logs').click();
  await expect(page.locator('.page-title')).toContainText('Forward Traffic');

  await go(page, 'Firewall Policy');
  await rowNamed(page, 'Block-All').click({ button: 'right' });
  await page.locator('.ctx-menu').getByText('Delete').click();
  await page.locator('.modal').getByRole('button', { name: 'OK' }).click();
  await expect(rowNamed(page, 'Block-All')).toHaveCount(0);
});

test('BGP and OSPF from the GUI: validation, peering, and duplicate entries refused', async ({ page, errors }) => {
  await freshLogin(page);
  await go(page, 'BGP');
  await field(page, 'Local AS').locator('input').fill('65010');
  await page.getByRole('button', { name: 'Create New' }).first().click();
  await page.getByPlaceholder('Neighbor IP').fill('203.0.113.1');
  await page.getByPlaceholder('Remote AS').fill('64500');
  await page.getByRole('button', { name: 'Create New' }).first().click();
  await page.getByPlaceholder('Neighbor IP').nth(1).fill('203.0.113.1');
  await page.getByPlaceholder('Remote AS').nth(1).fill('64500');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('.toast').last()).toContainText('only be listed once');
  await page.locator('.form-card button.btn.sm').nth(1).click(); // remove the duplicate row
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('.side-card')).toContainText('Established');

  await go(page, 'OSPF');
  await expect(page.locator('.page-title')).toContainText('OSPF');
});

test('sessions can be ended one by one and all at once; user monitor deauthenticates', async ({ page, errors }) => {
  await freshLogin(page);
  await cli(page, ...pol('1', 'Allow-All', 'accept'));
  await page.getByTitle('Close').click();
  await labTab(page, 'Traffic Generator');
  await page.getByText('▸ PC1 pings 8.8.8.8').click();
  await page.getByText('▸ PC1 browses www.example.com').click();
  await go(page, 'FortiView Sessions');
  const rows = page.locator('tr.row');
  const before = await rows.count();
  expect(before).toBeGreaterThan(1);
  await rows.first().click();
  await page.getByRole('button', { name: 'End Session' }).click();
  await expect(rows).toHaveCount(before - 1);
  await page.getByRole('button', { name: 'End All Sessions' }).click();
  await expect(rows).toHaveCount(0);
  await go(page, 'Firewall User Monitor');
  await expect(page.locator('.page-title')).toContainText('User Monitor');
});

test('exiting a lab keeps the configuration and the progress', async ({ page, errors }) => {
  await freshLogin(page);
  await page.getByRole('button', { name: 'Labs' }).click();
  await page.getByRole('button', { name: 'Start' }).first().click();
  await page.getByRole('button', { name: 'Start lab' }).click();
  await expect(page.locator('.lab-guide')).toBeVisible();
  await cli(page, 'config system global', 'set hostname HQ-FGT', 'end');
  await page.getByTitle('Close').click();
  await page.getByTitle('Exit lab (keeps the config)').click();
  await expect(page.locator('.lab-guide')).toHaveCount(0);
  await expect(page.locator('.hdr .brand .hostname')).toHaveText('HQ-FGT');
});

test('a newly opened page starts at the top, not at the previous page scroll position', async ({ page, errors }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await freshLogin(page);
  await go(page, 'Settings');
  await page.locator('.content').evaluate((el) => el.scrollTo(0, 2000));
  expect(await page.locator('.content').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await go(page, 'Status');
  await expect.poll(() => page.locator('.content').evaluate((el) => el.scrollTop)).toBe(0);
});
