import { test, expect, freshLogin, go, field, pick, toastText, labTab, rowNamed } from './helpers';

test('address and group: create, edit, refuse delete while used, then delete', async ({ page, errors }) => {
  await freshLogin(page);
  await go(page, 'Addresses');
  await page.getByRole('button', { name: 'Create New' }).click();
  await page.locator('.dropdown-menu .mi', { hasText: /^Address$/ }).click();
  await field(page, 'Name').locator('input').fill('LAN-Net');
  await field(page, 'IP/Netmask').locator('input').fill('192.168.1.0/24');
  await page.getByRole('button', { name: 'OK' }).click();
  const row = rowNamed(page, 'LAN-Net');
  await expect(row).toContainText('192.168.1.0/255.255.255.0');

  // invalid input is rejected
  await page.getByRole('button', { name: 'Create New' }).click();
  await page.locator('.dropdown-menu .mi', { hasText: /^Address$/ }).click();
  await field(page, 'Name').locator('input').fill('Bad');
  await field(page, 'IP/Netmask').locator('input').fill('999.1.1.1/24');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByText('Enter a valid IP/netmask')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // group using it
  await page.getByRole('button', { name: 'Create New' }).click();
  await page.locator('.dropdown-menu .mi', { hasText: 'Address Group' }).click();
  await field(page, 'Group name').locator('input').fill('HQ-Staff');
  await pick(page, 'Members', ['LAN-Net']);
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(rowNamed(page, 'HQ-Staff')).toContainText('LAN-Net');

  // deleting a referenced object is refused
  await row.click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => toastText(page)).toContain('cannot be deleted');

  // rename via edit propagates to the group
  await rowNamed(page, 'LAN-Net').dblclick();
  await field(page, 'Name').locator('input').fill('LAN-Net2');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(rowNamed(page, 'HQ-Staff')).toContainText('LAN-Net2');

  // delete group then address
  await rowNamed(page, 'HQ-Staff').click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.locator('.modal').getByRole('button', { name: 'OK' }).click();
  await rowNamed(page, 'LAN-Net2').click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.locator('.modal').getByRole('button', { name: 'OK' }).click();
  await expect(rowNamed(page, 'LAN-Net2')).toHaveCount(0);
});

test('policy built in the GUI makes traffic pass; disabling it blocks again; Policy Lookup agrees', async ({ page, errors }) => {
  await freshLogin(page);
  await labTab(page, 'Traffic Generator');
  await page.getByText('▸ PC1 pings 8.8.8.8').click();
  await expect(page.locator('.result').first()).toContainText('implicit deny');

  await go(page, 'Firewall Policy');
  await page.getByRole('button', { name: 'Create New' }).click();
  await field(page, 'Name').locator('input').fill('LAN-out');
  await pick(page, 'Incoming Interface', ['internal']);
  await pick(page, 'Outgoing Interface', ['wan1']);
  await pick(page, /^Source$/, ['all']);
  await pick(page, /^Destination$/, ['all']);
  await pick(page, /^Service$/, ['ALL']);
  await page.getByRole('button', { name: 'OK' }).click();
  const row = page.locator('tr.row', { hasText: 'LAN-out' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('ACCEPT');
  await expect(row).toContainText('NAT');

  await page.getByText('▸ PC1 pings 8.8.8.8').click();
  await expect(page.locator('.result').first()).toContainText('allowed by policy 1');
  await labTab(page, 'Packet Walk');
  await expect(page.locator('.walk')).toContainText('Source NAT');
  await labTab(page, 'Debug Flow');
  await expect(page.locator('.dock .console')).toContainText('Allowed by Policy-1: SNAT');

  // hit counter increased
  await expect(row.locator('td').last()).not.toHaveText('0');

  // right-click > Disable
  await row.click({ button: 'right' });
  await page.locator('.ctx-menu .mi', { hasText: 'Disable' }).click();
  await labTab(page, 'Traffic Generator');
  await page.getByText('▸ PC1 pings 8.8.8.8').click();
  await expect(page.locator('.result').first()).toContainText('implicit deny');
  await row.click({ button: 'right' });
  await page.locator('.ctx-menu .mi', { hasText: 'Enable' }).click();

  // Policy Lookup
  await page.getByRole('button', { name: 'Policy Lookup' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('.modal')).toContainText('matches policy 1');
  await page.locator('.modal').getByRole('button', { name: 'Close' }).click();
});

test('VIP and inbound policy publish the web server', async ({ page, errors }) => {
  await freshLogin(page);
  await go(page, 'Virtual IPs');
  await page.getByRole('button', { name: 'Create New' }).click();
  await field(page, 'Name').locator('input').fill('Web-VIP');
  await field(page, 'External IP address/range').locator('input').fill('203.0.113.10');
  await field(page, 'Map to IPv4 address/range').locator('input').fill('10.10.10.10');
  await page.locator('.section-title .toggle', { hasText: 'Port Forwarding' }).click();
  await field(page, 'External service port').locator('input').fill('80');
  await field(page, 'Map to IPv4 port').locator('input').fill('80');
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('tr.row', { hasText: 'Web-VIP' })).toContainText('203.0.113.10 → 10.10.10.10 (TCP: 80 → 80)');

  await go(page, 'Firewall Policy');
  await page.getByRole('button', { name: 'Create New' }).click();
  await field(page, 'Name').locator('input').fill('Web-in');
  await pick(page, 'Incoming Interface', ['wan1']);
  await pick(page, 'Outgoing Interface', ['dmz']);
  await pick(page, /^Source$/, ['all']);
  await pick(page, /^Destination$/, ['Web-VIP']);
  await pick(page, /^Service$/, ['HTTP']);
  await field(page, 'NAT').locator('.toggle').click();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('tr.row', { hasText: 'Web-in' })).toBeVisible();

  await labTab(page, 'Traffic Generator');
  await page.getByText('▸ Internet user visits your website').click();
  await expect(page.locator('.result').first()).toContainText('delivered and answered');
  await page.getByText('▸ Attacker tries SSH to your WAN').click();
  await expect(page.locator('.result').first()).toContainText('denied');
});
