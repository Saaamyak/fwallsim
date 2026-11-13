import { test, expect, freshLogin, labTab, cli, login } from './helpers';

test('start a lab from the catalog, guide ticks live, completion is recorded', async ({ page, errors }) => {
  await freshLogin(page);
  await page.getByTitle('Labs & Challenges').click();
  await expect(page.locator('.page-title', { hasText: 'Labs & Challenges' })).toBeVisible();
  const card = page.locator('.widget', { hasText: 'Your first firewall policy' });
  await card.getByRole('button', { name: /Start/ }).click();
  await page.locator('.modal .toggle').click(); // skip backup download
  await page.getByRole('button', { name: 'Start lab' }).click();
  const guide = page.locator('.lab-guide');
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('Tasks (0/4)');

  await cli(page, 'config firewall policy', 'edit 0', 'set name out', 'set srcintf internal', 'set dstintf wan1', 'set srcaddr all', 'set dstaddr all', 'set schedule always', 'set service ALL', 'set action accept', 'next', 'end');
  await expect(guide).toContainText('Tasks (1/4)'); // NAT is off by default
  await cli(page, 'config firewall policy', 'edit 1', 'set nat enable', 'next', 'end');
  await page.getByTitle('Close').click();
  // The config is right, but the two traffic tasks wait for a real test from the Traffic Generator.
  await expect(guide).toContainText('Tasks (2/4)');
  await labTab(page, 'Traffic Generator');
  await page.getByText('▸ PC1 pings 8.8.8.8').click();
  await expect(guide).toContainText('Tasks (3/4)');
  await page.getByText('▸ PC1 browses www.example.com').click();
  await expect(guide).toContainText('Tasks (4/4)');
  await expect(guide).toContainText('Lab complete!');

  await page.getByTitle('Labs & Challenges').click();
  await expect(page.locator('.big-num').first()).toContainText('1 /');
  await guide.getByTitle('Exit lab (keeps the config)').click();
  await expect(guide).toHaveCount(0);
});

test('a challenge reveals hints one by one and then the solution', async ({ page, errors }) => {
  await freshLogin(page);
  await page.getByTitle('Labs & Challenges').click();
  await page.locator('.widget', { hasText: 'Pings work, websites do not' }).getByRole('button', { name: /Start/ }).click();
  await page.locator('.modal .toggle').click();
  await page.getByRole('button', { name: 'Start lab' }).click();
  const guide = page.locator('.lab-guide');
  await guide.getByRole('button', { name: 'Show hint 1 of 3' }).click();
  await guide.getByRole('button', { name: 'Show hint 2 of 3' }).click();
  await guide.getByRole('button', { name: 'Show hint 3 of 3' }).click();
  await guide.getByRole('button', { name: 'Show solution' }).click();
  await expect(guide).toContainText('Add the service DNS');
  await labTab(page, 'Traffic Generator');
});

test('lab 1: the CLI task stays ticked after a reload (new browser session)', async ({ page, errors }) => {
  await freshLogin(page);
  await page.getByTitle('Labs & Challenges').click();
  await page.locator('.widget', { hasText: 'System basics' }).getByRole('button', { name: /Start/ }).click();
  await page.locator('.modal .toggle').click();
  await page.getByRole('button', { name: 'Start lab' }).click();
  const guide = page.locator('.lab-guide');
  await expect(guide).toContainText('Tasks (0/4)');
  await cli(page, 'get system status');
  await page.getByTitle('Close').click();
  await expect(guide).toContainText('Tasks (1/4)');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await login(page, 'admin', 'Admin123!');
  await expect(page.locator('.lab-guide')).toContainText('Tasks (1/4)');
});
