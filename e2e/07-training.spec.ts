import { test, expect, freshLogin, labTab, cli } from './helpers';

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
