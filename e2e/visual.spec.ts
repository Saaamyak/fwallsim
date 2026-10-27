// Screenshots for manual visual review: `npx playwright test e2e/visual.spec.ts` → e2e-results/screens/
import { test, expect, fresh, freshLogin, go, labTab, cli } from './helpers';

const shot = (name: string) => `e2e-results/screens/${name}.png`;

test('visual review screenshots', async ({ page, errors }) => {
  await fresh(page);
  await page.screenshot({ path: shot('01-login') });
  await freshLogin(page);
  await page.locator('.dock-tab', { hasText: 'Scenario' }).click();
  await page.locator('.dropdown-menu .mi', { hasText: 'Small office' }).click();
  await labTab(page, 'Traffic Generator');
  await page.getByText('▸ PC1 browses www.example.com').click();
  await page.getByText('▸ Attacker tries SSH to your WAN').click();
  await go(page, 'Status');
  await page.screenshot({ path: shot('02-dashboard') });
  await go(page, 'Firewall Policy');
  await page.screenshot({ path: shot('03-policy-list') });
  await page.locator('tr.row').first().dblclick();
  await page.screenshot({ path: shot('04-policy-edit'), fullPage: true });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await go(page, 'Interfaces');
  await page.screenshot({ path: shot('05-interfaces') });
  await labTab(page, 'Packet Walk');
  await page.screenshot({ path: shot('06-packet-walk') });
  await labTab(page, 'Topology');
  await page.screenshot({ path: shot('07-topology') });
  await cli(page, 'show firewall policy 1', 'get router info routing-table all');
  await page.screenshot({ path: shot('08-cli') });
  await page.getByTitle('Close').click();
  await page.getByTitle('Labs & Challenges').click();
  await page.locator('.widget', { hasText: 'Rule order matters' }).getByRole('button', { name: /Start/ }).click();
  await page.locator('.modal .toggle').click();
  await page.getByRole('button', { name: 'Start lab' }).click();
  await expect(page.locator('.lab-guide')).toBeVisible();
  await page.screenshot({ path: shot('09-lab-guide') });
  await page.locator('.lab-guide').getByTitle('Exit lab (keeps the config)').click();
  await go(page, 'SD-WAN');
  await page.screenshot({ path: shot('10-sdwan') });
  // dark theme
  await go(page, 'Settings');
  await page.getByRole('button', { name: 'Dark Matter' }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await go(page, 'Status');
  await page.screenshot({ path: shot('11-dark-dashboard') });
  await go(page, 'Firewall Policy');
  await labTab(page, 'Packet Walk');
  await page.screenshot({ path: shot('12-dark-policy-walk') });
  await page.setViewportSize({ width: 1280, height: 720 });
  await go(page, 'Addresses');
  await page.screenshot({ path: shot('13-dark-1280x720') });
});
