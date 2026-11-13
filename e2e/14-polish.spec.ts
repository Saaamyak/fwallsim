// Phone and tablet polish: no iOS zoom on fields, a Lab Guide that can be minimised, Esc closes
// dialogs, the slide-in menu closes on its current page, and nothing overflows with the guide open.
import type { Page } from '@playwright/test';
import { test, expect, freshLogin } from './helpers';

const store = (page: Page, code: string) => page.evaluate(`import('/src/store.ts').then((s) => { ${code} })`);

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('fields use 16 px text so iOS does not zoom in, and a maximised Lab panel shrinks the guide to a bar', async ({ page, errors }) => {
    await freshLogin(page);
    await store(page, "s.loadScenario('starter'); s.navigate('pol-policy', '1')");
    for (const sel of ['.field input', '.field select', '.side-search input']) {
      expect(await page.locator(sel).first().evaluate((e) => getComputedStyle(e).fontSize), sel).toBe('16px');
    }
    await store(page, "s.startLab('c1-no-internet'); s.setUi({ dock: 'max' })");
    await expect(page.locator('.lab-guide.mini')).toBeVisible();
    await expect(page.locator('.lab-guide h3')).toHaveCount(0);
    // the bar brings the guide back and makes room for it
    await page.getByTitle('Show the lab guide').click();
    await expect(page.locator('.lab-guide h3')).toBeVisible();
    await expect(page.locator('.dock')).toHaveClass(/normal/);
  });
});

test.describe('tablet portrait', () => {
  test.use({ viewport: { width: 810, height: 1080 }, hasTouch: true });

  test('with the Lab Guide open, forms fit the page area and nothing scrolls sideways', async ({ page, errors }) => {
    await freshLogin(page);
    await store(page, "s.startLab('c1-no-internet'); s.navigate('pol-policy', '1')");
    await expect(page.locator('.lab-guide h3')).toBeVisible();
    await expect(page.locator('.page-title', { hasText: 'Edit Policy' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(810);
    const [content, card] = await Promise.all([page.locator('.content').boundingBox(), page.locator('.form-card').boundingBox()]);
    expect(card!.x + card!.width).toBeLessThanOrEqual(content!.x + content!.width);
    // labels are not cut off: each label fits inside its own column
    const cut = await page.locator('.field > label').evaluateAll((ls) => ls.filter((l) => l.scrollWidth > l.clientWidth + 1).length);
    expect(cut).toBe(0);
  });

  test('tapping the page that is already open closes the slide-in menu', async ({ page, errors }) => {
    await freshLogin(page);
    const side = page.locator('nav.side');
    await page.getByTitle('Open menu').click();
    await expect(side).toBeVisible();
    await side.locator('.nav-sub .nav-item.active').click();
    await expect(side).toBeHidden();
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the Lab Guide minimises to a bar, comes back, and remembers the choice for the session', async ({ page, errors }) => {
    await freshLogin(page);
    await store(page, "s.startLab('l1-basics')");
    await expect(page.locator('.lab-guide h3')).toBeVisible();
    await page.getByTitle('Minimise guide').click();
    await expect(page.locator('.lab-guide.mini')).toBeVisible();
    await expect(page.locator('.lab-guide h3')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.lab-guide.mini')).toBeVisible();
    await page.getByTitle('Show the lab guide').click();
    await expect(page.locator('.lab-guide h3')).toBeVisible();
    await page.reload();
    await expect(page.locator('.lab-guide h3')).toBeVisible();
  });

  test('Esc closes a dialog, and its X is labelled "Close"', async ({ page, errors }) => {
    await freshLogin(page);
    await page.getByTitle('Help').click();
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Close' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
  });

  test('Lab panel tabs stay on one line, and the CLI opens beside the Lab Guide', async ({ page, errors }) => {
    await freshLogin(page);
    await store(page, "s.startLab('c1-no-internet')");
    const tabs = page.locator('.dock-bar button.dock-tab[title]');
    await expect(tabs.first()).toBeVisible();
    const heights = await tabs.evaluateAll((ts) => ts.map((t) => t.getBoundingClientRect().height));
    expect(Math.max(...heights)).toBeLessThanOrEqual(28);
    const tops = await tabs.evaluateAll((ts) => ts.map((t) => Math.round(t.getBoundingClientRect().top)));
    expect(new Set(tops).size, 'tabs on one row').toBe(1);
    await page.getByTitle('CLI Console').click();
    const [cli, guide] = await Promise.all([page.locator('.cli-win').boundingBox(), page.locator('.lab-guide').boundingBox()]);
    expect(cli!.x + cli!.width).toBeLessThanOrEqual(guide!.x);
  });
});
