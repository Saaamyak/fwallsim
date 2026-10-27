import { test, expect, freshLogin, go, field, pick, labTab, cli, login, toastText } from './helpers';

test('SD-WAN in the GUI survives an ISP1 outage', async ({ page, errors }) => {
  await freshLogin(page);
  await page.locator('.dock-tab', { hasText: 'Scenario' }).click();
  await page.locator('.dropdown-menu .mi', { hasText: 'Small office' }).click();
  await labTab(page, 'WAN');
  await page.locator('.toggle', { hasText: 'Cable plugged into ISP2' }).click();
  await go(page, 'SD-WAN');
  await page.locator('.toggle', { hasText: 'SD-WAN disabled' }).click();
  await page.locator('select', { hasText: 'Add SD-WAN member' }).selectOption('wan2');
  await page.getByRole('button', { name: 'Apply' }).click();
  // wan1 is used by policies: the GUI refuses until they use the zone
  await page.locator('select', { hasText: 'Add SD-WAN member' }).selectOption('wan1');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Change those to the SD-WAN zone')).toBeVisible();
  await cli(page, 'config firewall policy', 'edit 1', 'set dstintf virtual-wan-link', 'next', 'edit 3', 'set dstintf virtual-wan-link', 'next', 'edit 2', 'set srcintf virtual-wan-link', 'next', 'end');
  await page.getByTitle('Close').click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => toastText(page)).toContain('SD-WAN settings applied');
  await page.getByRole('button', { name: 'Performance SLAs' }).click();
  await page.getByRole('button', { name: 'Create New Performance SLA' }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('.badge', { hasText: 'Alive' }).first()).toBeVisible();

  await go(page, 'Static Routes');
  await page.getByRole('button', { name: 'Create New' }).click();
  await field(page, 'Interface').locator('select').selectOption({ label: 'SD-WAN zone: virtual-wan-link' });
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('tr.row', { hasText: 'SD-WAN zone virtual-wan-link' })).toBeVisible();

  await labTab(page, 'WAN');
  await page.locator('.toggle', { hasText: 'ISP1 outage' }).click();
  await expect(page.locator('.dock-body')).toContainText('wan1 dead');
  await page.getByRole('button', { name: 'PC1 → 8.8.8.8' }).click();
  await expect(page.locator('.walk')).toContainText('delivered and answered');
  await expect(page.locator('.walk')).toContainText('wan2');
});

test('read-only admin profile, trusted host, permission denied keeps the form open', async ({ page, errors }) => {
  await freshLogin(page);
  await go(page, 'Admin Profiles');
  await page.getByRole('button', { name: 'Create New' }).click();
  await field(page, 'Name').locator('input').fill('helpdesk');
  await page.getByRole('button', { name: 'Set all: Read', exact: true }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  await go(page, 'Administrators');
  await page.getByRole('button', { name: 'Create New' }).click();
  await field(page, 'Username').locator('input').fill('hd1');
  await field(page, 'Password').locator('input').fill('HelpDesk1');
  await field(page, 'Confirm Password').locator('input').fill('HelpDesk1');
  await field(page, 'Administrator profile').locator('select').selectOption('helpdesk');
  await page.locator('.toggle', { hasText: 'Restrict login to trusted hosts' }).click();
  await field(page, 'Trusted Host 1').locator('input').fill('192.168.1.110/32');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('tr.row', { hasText: 'hd1' })).toContainText('192.168.1.110/255.255.255.255');

  await page.locator('.hdr .dropdown button').last().click();
  await page.getByText('Logout').click();
  await page.getByPlaceholder('Username').fill('hd1');
  await page.getByPlaceholder('Password', { exact: true }).fill('HelpDesk1');
  await page.locator('.login-card select').selectOption('pc2');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByText('Authentication failure')).toBeVisible();
  await page.locator('.login-card select').selectOption('pc1');
  await login(page, 'hd1', 'HelpDesk1');
  await expect(page.locator('.hdr')).toContainText('read-only');
  await go(page, 'Addresses');
  await page.getByRole('button', { name: 'Create New' }).click();
  await page.locator('.dropdown-menu .mi', { hasText: /^Address$/ }).click();
  await field(page, 'Name').locator('input').fill('nope');
  await field(page, 'IP/Netmask').locator('input').fill('10.1.1.0/24');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect.poll(() => toastText(page)).toContain('Permission denied');
  await expect(page.locator('.page-title', { hasText: 'New Address' })).toBeVisible();
});

test('local-in policy, SNMP walk from NMS, syslog delivery, firmware upgrade path', async ({ page, errors }) => {
  await freshLogin(page);
  await page.locator('.dock-tab', { hasText: 'Scenario' }).click();
  await page.locator('.dropdown-menu .mi', { hasText: 'Small office' }).click();

  // SNMP
  await cli(page, 'config system interface', 'edit dmz', 'append allowaccess snmp', 'next', 'end');
  await page.getByTitle('Close').click();
  await go(page, 'SNMP');
  await page.locator('.section-title .toggle', { hasText: 'SNMP Agent' }).click();
  await page.getByRole('button', { name: 'Create New community' }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await labTab(page, 'Mgmt');
  await page.getByRole('button', { name: 'Run snmpwalk' }).click();
  await expect(page.locator('.dock-body')).toContainText('sysName.0 = STRING: FWS60F');

  // syslog
  await go(page, 'Log Settings');
  await field(page, 'Send logs to syslog').locator('.toggle').click();
  await field(page, 'IP Address/FQDN').locator('input').fill('10.10.10.30');
  await page.getByRole('button', { name: 'Apply remote logging' }).click();
  await expect(page.getByText('Delivering to NMS-Server')).toBeVisible();
  await labTab(page, 'Traffic Generator');
  await page.getByText('▸ PC1 pings 8.8.8.8').click();
  await labTab(page, 'Mgmt');
  await expect(page.locator('.dock-body .console')).toContainText('type="traffic"');

  // local-in
  await go(page, 'Local-In Policy');
  await page.getByRole('button', { name: 'Create New' }).click();
  await field(page, 'Interface').locator('select').selectOption('dmz');
  await pick(page, 'Service', ['SNMP']);
  await page.getByRole('button', { name: 'OK' }).click();
  await labTab(page, 'Mgmt');
  await page.getByRole('button', { name: 'Run snmpwalk' }).click();
  await expect(page.locator('.dock-body')).toContainText('Blocked by local-in policy 1');

  // firmware
  await go(page, 'Firmware & Registration');
  const row760 = page.locator('tr.row', { hasText: 'v7.6.0' });
  await expect(row760).toContainText('upgrade to 7.4.5 first');
  await expect(row760.getByRole('button', { name: 'Upgrade' })).toBeDisabled();
  await page.locator('tr.row', { hasText: 'v7.4.5' }).getByRole('button', { name: 'Upgrade' }).click();
  await page.locator('.modal .toggle').click(); // no backup download
  await page.getByRole('button', { name: 'Confirm and Upgrade' }).click();
  await expect(page.getByPlaceholder('Username')).toBeVisible({ timeout: 10_000 });
  await login(page, 'admin', 'Admin123!');
  await expect(page.locator('.form-card')).toContainText('FortiOS v7.4.5 build2702');
  await go(page, 'Status');
  await expect(page.locator('.widget', { hasText: 'System Information' })).toContainText('v7.4.5');
});
