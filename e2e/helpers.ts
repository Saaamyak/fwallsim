import { expect, test as base, type Page } from '@playwright/test';

/** Every test fails if the page throws or logs a console error. */
export const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    await use(errors);
    expect(errors, 'browser errors during the test').toEqual([]);
  },
});
export { expect };

/** Factory state: clear browser storage and reload. */
export async function fresh(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
}

/**
 * Log in as admin. On a fresh unit this goes through the Welcome screen and "Create your admin
 * password" (with newPw); otherwise it uses the login form, handling a forced password change.
 */
export async function login(page: Page, user = 'admin', pw = '', newPw = 'Admin123!') {
  await page.locator('.login-card').first().waitFor();
  const phoneOk = page.getByRole('button', { name: 'Continue on this phone' });
  if (await phoneOk.isVisible().catch(() => false)) await phoneOk.click();
  const start = page.getByRole('button', { name: 'Get started' });
  if (await start.isVisible().catch(() => false)) await start.click();
  if (await page.getByText('Create your admin password').isVisible().catch(() => false)) {
    await page.getByPlaceholder('New Password').fill(newPw);
    await page.getByPlaceholder('Confirm Password').fill(newPw);
    await page.getByRole('button', { name: 'Save and log in' }).click();
    await expect(page.locator('.hdr')).toBeVisible();
    return;
  }
  await page.getByPlaceholder('Username').fill(user);
  await page.getByPlaceholder('Password', { exact: true }).fill(pw);
  await page.getByRole('button', { name: 'Login' }).click();
  const change = page.getByText('You are required to change your password');
  if (await change.isVisible().catch(() => false)) {
    await page.getByPlaceholder('New Password').fill(newPw);
    await page.getByPlaceholder('Confirm Password').fill(newPw);
    await page.getByRole('button', { name: 'OK' }).click();
  }
  await expect(page.locator('.hdr')).toBeVisible();
}

export async function freshLogin(page: Page) {
  await fresh(page);
  await login(page);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Navigate with the sidebar search, the way a user would. */
export async function go(page: Page, label: string) {
  const search = page.getByPlaceholder('Search menu');
  await search.fill(label);
  await page.locator('.nav-sub .nav-item', { hasText: new RegExp(`^${esc(label)}`) }).first().click();
  await search.fill('');
}

/** Click a toolbar/dropdown button by visible text. */
export async function click(page: Page, text: string | RegExp) {
  await page.getByRole('button', { name: text }).first().click();
}

/** The labelled form row's input (Field component: <label> + control). */
export function field(page: Page, label: string | RegExp) {
  const re = typeof label === 'string' ? new RegExp('^\\s*' + esc(label) + '\\s*$') : label;
  return page.locator('.field', { has: page.locator('label', { hasText: re }) }).first();
}

/** Pick entries in an EntryPicker drawer for the field with this label. */
export async function pick(page: Page, label: string | RegExp, names: string[]) {
  await field(page, label).locator('.picker').click();
  const drawer = page.locator('.drawer');
  await expect(drawer).toBeVisible();
  for (const n of names) {
    await drawer.getByPlaceholder('Search').fill(n);
    await drawer.locator('.pick-item', { has: page.locator('.chip', { hasText: new RegExp(`^${esc(n)}$`) }) }).first().click();
  }
  if (await drawer.isVisible().catch(() => false)) await drawer.getByRole('button', { name: 'Close' }).click();
}

export async function toastText(page: Page) {
  return (await page.locator('.toast').allTextContents()).join(' | ');
}

/** Open a Lab dock tab. */
export async function labTab(page: Page, name: string) {
  await page.locator('.dock-tab', { hasText: name }).first().click();
}

/** Run CLI commands in the console window. */
export async function cli(page: Page, ...lines: string[]) {
  if (!(await page.locator('.cli-win').isVisible().catch(() => false))) await page.getByTitle('CLI Console').click();
  const input = page.locator('.cli-win input.cli-inline');
  for (const l of lines) {
    await input.fill(l);
    await input.press('Enter');
  }
  return page.locator('.cli-win .console');
}

/** Table row whose first column is exactly this name. */
export function rowNamed(page: Page, name: string) {
  return page.locator('tr.row').filter({ has: page.locator('td:first-child', { hasText: new RegExp('^\\s*' + esc(name) + '\\s*$') }) });
}
