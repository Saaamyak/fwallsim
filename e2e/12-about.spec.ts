import { test, expect, fresh, login } from './helpers';

test('Welcome screen: About & privacy opens the About panel', async ({ page }) => {
  await fresh(page);
  const phoneOk = page.getByRole('button', { name: 'Continue on this phone' });
  if (await phoneOk.isVisible().catch(() => false)) await phoneOk.click();
  await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
  await page.getByRole('button', { name: 'About & privacy' }).click();
  const modal = page.locator('.modal');
  await expect(modal).toContainText('About FWallSim');
  await expect(modal).toContainText('Your data');
  await expect(modal).toContainText('not affiliated');
  await expect(modal).toContainText('never sent anywhere');
  await modal.locator('.modal-hdr button').click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
});

test('Header Help button shows version, privacy and the source link', async ({ page }) => {
  await fresh(page);
  await login(page);
  await page.getByTitle('Help').click();
  const modal = page.locator('.modal');
  await expect(modal).toContainText(/FWallSim v\d+\.\d+\.\d+ · simulated firmware v\d+\.\d+\.\d+/);
  await expect(modal).toContainText('Your data');
  const link = modal.getByRole('link', { name: 'github.com/Saaamyak/fwallsim' });
  await expect(link).toHaveAttribute('href', 'https://github.com/Saaamyak/fwallsim');
  await expect(link).toHaveAttribute('target', '_blank');
  await modal.locator('.modal-hdr button').click();
  await expect(modal).toHaveCount(0);
});

test('Login screen has the About & privacy link too', async ({ page }) => {
  await fresh(page);
  await login(page);
  await page.getByTitle('Help').waitFor();
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByPlaceholder('Username').waitFor();
  await page.getByRole('button', { name: 'About & privacy' }).click();
  await expect(page.locator('.modal')).toContainText('Your data');
});
