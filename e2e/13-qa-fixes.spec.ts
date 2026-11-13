import { test, expect, freshLogin, go, field, rowNamed } from './helpers';

test('new address form starts empty and saves a typed subnet', async ({ page }) => {
  await freshLogin(page);
  await go(page, 'Addresses');
  await page.getByRole('button', { name: 'Create New' }).click();
  await page.locator('.dropdown-menu .mi', { hasText: /^Address$/ }).click();

  // no field of a new address may show "undefined" (it used to show "/undefined")
  for (const v of await page.locator('.page input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))) {
    expect(v).not.toContain('undefined');
  }
  await expect(field(page, 'IP/Netmask').locator('input')).toHaveValue('');

  await field(page, 'Name').locator('input').fill('QA-Net');
  await field(page, 'IP/Netmask').locator('input').pressSequentially('192.168.1.0/24'); // typed, like a user
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(rowNamed(page, 'QA-Net')).toContainText('192.168.1.0/255.255.255.0');

  // editing shows the subnet in the same short form
  await rowNamed(page, 'QA-Net').dblclick();
  await expect(field(page, 'IP/Netmask').locator('input')).toHaveValue('192.168.1.0/24');
});
