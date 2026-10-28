// Phones and tablets: the phone notice, the slide-in menu, and no page wider than the screen.
import type { Page } from '@playwright/test';
import { test, expect, fresh, login } from './helpers';

const PHONE = { width: 390, height: 844 };
const TABLET = { width: 820, height: 1180 };

/** Every simulated page fits the screen width (wide tables scroll inside their own area). */
async function noPageTooWide(page: Page, width: number) {
  const ids: string[] = await page.evaluate(async () => {
    const m = await import('/src/gui/menu.ts');
    return m.MENU.flatMap((g) => g.items.filter((i) => !i.phase).map((i) => i.id));
  });
  const wide: string[] = [];
  for (const id of ids) {
    await page.evaluate(async (id) => (await import('/src/store.ts')).navigate(id, null), id);
    await page.waitForTimeout(80);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    if (w > width + 1) wide.push(`${id} (${w}px)`);
  }
  expect(wide, 'pages wider than the screen').toEqual([]);
}

test.describe('phone', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('a phone sees the "best on a computer" notice once, then the usual first visit', async ({ page, errors }) => {
    await fresh(page);
    await expect(page.getByText('Best on a computer or tablet')).toBeVisible();
    await page.getByRole('button', { name: 'Continue on this phone' }).click();
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Best on a computer or tablet')).toHaveCount(0);
    await login(page);
    await expect(page.locator('.page-title', { hasText: 'Dashboard' })).toBeVisible();
  });

  test('on a phone the menu slides in, closes after choosing a page, and nothing is wider than the screen', async ({ page, errors }) => {
    await fresh(page);
    await login(page);
    const side = page.locator('nav.side');
    await expect(side).toBeHidden();
    await page.getByTitle('Open menu').click();
    await expect(side).toBeVisible();
    await side.getByText('Policy & Objects').click();
    await side.getByText('Firewall Policy').click();
    await expect(page.locator('.page-title', { hasText: 'Firewall Policy' })).toBeVisible();
    await expect(side).toBeHidden();
    // the backdrop closes it too
    await page.getByTitle('Open menu').click();
    await page.locator('.side-backdrop').click({ position: { x: PHONE.width - 10, y: 300 } });
    await expect(side).toBeHidden();
    // form labels sit above their fields
    await page.evaluate(async () => (await import('/src/store.ts')).loadScenario('starter'));
    await page.evaluate(async () => (await import('/src/store.ts')).navigate('pol-policy', '1'));
    const [label, input] = await Promise.all([page.locator('.field label').first().boundingBox(), page.locator('.field input').first().boundingBox()]);
    expect(input!.y).toBeGreaterThan(label!.y + label!.height - 1);
    // the CLI fits the screen
    await page.getByTitle('CLI Console').click();
    const cli = await page.locator('.cli-win').boundingBox();
    expect(cli!.x).toBeGreaterThanOrEqual(0);
    expect(cli!.x + cli!.width).toBeLessThanOrEqual(PHONE.width);
    await page.getByTitle('Close').first().click();
    await noPageTooWide(page, PHONE.width);
  });
});

test.describe('tablet', () => {
  test.use({ viewport: TABLET, hasTouch: true });

  test('on a tablet there is no phone notice, the menu slides in, and nothing is wider than the screen', async ({ page, errors }) => {
    await fresh(page);
    await expect(page.getByText('Best on a computer or tablet')).toHaveCount(0);
    await login(page);
    await expect(page.locator('nav.side')).toBeHidden();
    await page.getByTitle('Open menu').click();
    await expect(page.locator('nav.side')).toBeVisible();
    await page.locator('.side-backdrop').click({ position: { x: TABLET.width - 10, y: 300 } });
    await expect(page.locator('nav.side')).toBeHidden();
    await noPageTooWide(page, TABLET.width);
  });
});
