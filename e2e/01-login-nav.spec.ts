import { test, expect, fresh, login, freshLogin } from './helpers';

test('first visit: welcome, create the admin password, then the new password works', async ({ page, errors }) => {
  await fresh(page);
  await expect(page.getByText('Learn firewalls by building one')).toBeVisible();
  await expect(page.getByText('not affiliated with or endorsed by Fortinet')).toBeVisible();
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByText('Create your admin password')).toBeVisible();
  await expect(page.getByText("Don't reuse a real password")).toBeVisible();
  await page.getByRole('button', { name: 'Save and log in' }).click();
  await expect(page.getByText('Password cannot be empty.')).toBeVisible();
  await page.getByPlaceholder('New Password').fill('Secret1!');
  await page.getByPlaceholder('Confirm Password').fill('Different');
  await page.getByRole('button', { name: 'Save and log in' }).click();
  await expect(page.getByText('Passwords do not match.')).toBeVisible();
  await page.getByPlaceholder('Confirm Password').fill('Secret1!');
  await page.getByRole('button', { name: 'Save and log in' }).click();
  await expect(page.locator('.page-title', { hasText: 'Dashboard · Status' })).toBeVisible();
  // the password is stored as a hash, never as typed
  expect(await page.evaluate(() => localStorage.getItem('fwallsim.config.v1'))).not.toContain('Secret1!');
  // logout and back in with the new password; a wrong password is refused; no welcome again
  await page.locator('.hdr .dropdown button').last().click();
  await page.getByText('Logout').click();
  await page.reload();
  await expect(page.getByPlaceholder('Username')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get started' })).toHaveCount(0);
  await page.getByPlaceholder('Password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByText('Authentication failure')).toBeVisible();
  await login(page, 'admin', 'Secret1!');
  await expect(page.locator('.page-title', { hasText: 'Dashboard' })).toBeVisible();
});

test('header shows the product, hostname and version without duplication', async ({ page, errors }) => {
  await freshLogin(page);
  await expect(page.locator('.hdr .brand .brand-name')).toHaveText('FWallSim');
  await expect(page.locator('.hdr .brand .hostname')).toHaveText('FWS60F');
  await expect(page.locator('.side-foot')).toHaveText('FWallSim v1.0.0');
});

test('every menu page opens without errors', async ({ page, errors }) => {
  await freshLogin(page);
  const groupCount = await page.locator('.side .nav-group').count();
  expect(groupCount).toBeGreaterThan(8);
  let visited = 0;
  for (let gi = 0; gi < groupCount; gi++) {
    const group = page.locator('.side .nav-group').nth(gi);
    const header = group.locator('.nav-item').first();
    if (!(await group.locator('.nav-sub').isVisible().catch(() => false))) await header.click();
    const items = group.locator('.nav-sub .nav-item');
    const n = await items.count();
    for (let i = 0; i < n; i++) {
      await items.nth(i).click();
      await expect(page.locator('.content .page')).toBeVisible();
      visited++;
    }
  }
  expect(visited).toBeGreaterThan(45);
});

test('theme switch to Dark Matter applies and survives a reload', async ({ page, errors }) => {
  await freshLogin(page);
  await page.getByPlaceholder('Search menu').fill('Settings');
  await page.locator('.nav-sub .nav-item', { hasText: /^Settings$/ }).click();
  await page.getByRole('button', { name: 'Dark Matter' }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark-matter');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark-matter');
});
