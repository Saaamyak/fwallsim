import { test, expect, freshLogin, go, field, pick, labTab, cli } from './helpers';

test('LDAP server test connectivity, identity policy and portal login', async ({ page, errors }) => {
  await freshLogin(page);
  await page.locator('.dock-tab', { hasText: 'Scenario' }).click();
  await page.locator('.dropdown-menu .mi', { hasText: 'Small office' }).click();
  await go(page, 'LDAP Servers');
  await page.getByRole('button', { name: 'Create New' }).click();
  await field(page, 'Name').locator('input').fill('LAB-AD');
  await field(page, 'Server IP/Name').locator('input').fill('10.10.10.20');
  await field(page, 'Distinguished Name').locator('input').fill('dc=lab,dc=local');
  await field(page, 'Username').locator('input').fill('cn=fwbind,cn=Users,dc=lab,dc=local');
  await field(page, 'Password').locator('input').fill('wrong');
  await page.getByRole('button', { name: 'Test Connectivity' }).click();
  await expect(page.getByText('Invalid credentials')).toBeVisible();
  await field(page, 'Password').locator('input').fill('Bind123!');
  await page.getByRole('button', { name: 'Test Connectivity' }).click();
  await expect(page.locator('.walk-lines', { hasText: 'Successful' })).toBeVisible();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('tr.row', { hasText: 'LAB-AD' })).toContainText('Successful');

  // group restricted to Sales, policy 1 requires it (via CLI for speed)
  await cli(page, 'config user group', 'edit Sales', 'set member LAB-AD', 'config match', 'edit 1', 'set server-name LAB-AD', 'set group-name "CN=Sales,OU=Groups,DC=lab,DC=local"', 'next', 'end', 'next', 'end', 'config firewall policy', 'edit 1', 'append groups Sales', 'next', 'end');
  await page.getByTitle('Close').click();

  await labTab(page, 'Traffic Generator');
  await page.getByText('▸ PC1 browses www.example.com').click();
  // unauthenticated: DNS cannot trigger the login page, so the identity policy is skipped
  await expect(page.locator('.result').first()).toContainText('DNS lookup for www.example.com failed');
  await page.locator('.lab-form input').first().fill('93.184.216.34');
  await page.getByRole('button', { name: 'Send traffic' }).click();
  await expect(page.locator('.result').first()).toContainText('authentication portal');

  await labTab(page, 'Users');
  await page.locator('.lab-form input').nth(0).fill('jsmith');
  await page.locator('.lab-form input').nth(1).fill('Sales123!');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.locator('.lab-form')).toContainText('Authentication successful');
  await labTab(page, 'Traffic Generator');
  await page.getByText('▸ PC1 browses www.example.com').click();
  await expect(page.locator('.result').first()).toContainText('delivered and answered');
  await go(page, 'Firewall User Monitor');
  await expect(page.locator('tr.row', { hasText: 'jsmith' })).toContainText('Sales');
});

test('IPsec wizard builds a working tunnel to the branch', async ({ page, errors }) => {
  await freshLogin(page);
  await page.locator('.dock-tab', { hasText: 'Scenario' }).click();
  await page.locator('.dropdown-menu .mi', { hasText: 'Small office' }).click();
  await go(page, 'IPsec Wizard');
  await page.getByRole('button', { name: 'Next >' }).click();
  await field(page, 'Pre-shared key').locator('input').fill('Branch-PSK-2026');
  await page.getByRole('button', { name: 'Next >' }).click();
  await page.getByRole('button', { name: 'Next >' }).click();
  await expect(page.getByText('The following will be created')).toBeVisible();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('tr.row', { hasText: 'to-branch' })).toContainText('Up');
  await labTab(page, 'VPN');
  await page.getByRole('button', { name: 'PC1 → Branch-PC ping' }).click();
  await expect(page.locator('.walk')).toContainText('delivered and answered');
  await labTab(page, 'VPN');
  await page.getByRole('button', { name: 'Branch-PC → PC1 RDP' }).click();
  await expect(page.locator('.walk')).toContainText('delivered and answered');
});

test('SSL-VPN: settings in the GUI, FortiClient connects from the lab', async ({ page, errors }) => {
  await freshLogin(page);
  await page.locator('.dock-tab', { hasText: 'Scenario' }).click();
  await page.locator('.dropdown-menu .mi', { hasText: 'Small office' }).click();
  await cli(page, 'config user local', 'edit r1', 'set passwd Remote99', 'next', 'end', 'config user group', 'edit VPN-Users', 'set member r1', 'next', 'end',
    'config firewall policy', 'edit 0', 'set name ssl-in', 'set srcintf ssl.root', 'set dstintf internal', 'set srcaddr all', 'set dstaddr LAN-Subnet', 'set groups VPN-Users', 'set schedule always', 'set service ALL', 'set action accept', 'next', 'end');
  await page.getByTitle('Close').click();
  await go(page, 'SSL-VPN Settings');
  await pick(page, 'Listen on Interface(s)', ['wan1']);
  await field(page, 'Listen on Port').locator('input').fill('10443');
  await page.getByRole('button', { name: 'Create New rule' }).click();
  await page.locator('.picker').last().click();
  await page.locator('.drawer .pick-item', { hasText: 'VPN-Users' }).click();
  await page.locator('.drawer').getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Apply' }).click();

  await labTab(page, 'VPN');
  const inputs = page.locator('.dock-body input');
  await inputs.nth(1).fill('10443');
  await inputs.nth(2).fill('r1');
  await inputs.nth(3).fill('Remote99');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.locator('.dock-body')).toContainText('Connected as r1');
  await page.getByRole('button', { name: 'Laptop → PC1 RDP' }).click();
  await expect(page.locator('.walk')).toContainText('delivered and answered');
});
