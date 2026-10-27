// Deep-QA sweep: on every menu page, press Apply on untouched forms, open Create New and the
// first row's edit form, then cancel. Nothing may throw, and untouched forms must save cleanly.
import type { Page } from '@playwright/test';
import { test, expect, freshLogin } from './helpers';

async function app(page: Page, url: string, fn: string, ...args: unknown[]) {
  await page.evaluate(async ({ url, fn, args }) => (await import(/* @vite-ignore */ url))[fn](...args), { url, fn, args });
  await page.waitForTimeout(150);
}

async function sweep(page: Page, label: string) {
  const issues: string[] = [];
  const groups = page.locator('.side .nav-group');
  const gc = await groups.count();
  for (let gi = 0; gi < gc; gi++) {
    const group = groups.nth(gi);
    if (!(await group.locator('.nav-sub').isVisible().catch(() => false))) await group.locator('.nav-item').first().click();
    const items = group.locator('.nav-sub .nav-item');
    const n = await items.count();
    for (let i = 0; i < n; i++) {
      const name = ((await items.nth(i).innerText()).split('\n')[0] ?? '').trim();
      if (/^Training/.test(name)) continue;
      await items.nth(i).click();
      const where = `[${label}] ${name}`;
      // mark toasts as seen instead of removing them (React owns those nodes)
      const errToast = async (step: string) => {
        const t = page.locator('.toast.err:not([data-seen])');
        if (await t.count()) issues.push(`${where} / ${step}: ${await t.first().innerText()}`);
        await page.evaluate(() => document.querySelectorAll('.toast').forEach((x) => x.setAttribute('data-seen', '1')));
      };
      const content = page.locator('.content .page');
      // 1. untouched Apply must not error
      const apply = content.getByRole('button', { name: 'Apply', exact: true });
      if ((await apply.count()) && (await apply.first().isEnabled())) {
        await apply.first().click();
        await page.waitForTimeout(100);
        await errToast('Apply untouched');
        const errText = content.locator('.err-text, .form-err');
        if (await errText.count()) {
          const txt = (await errText.first().innerText()).trim();
          if (txt) issues.push(`${where} / Apply untouched: ${txt}`);
        }
      }
      // 2. first row: open edit, press OK without changes, must save cleanly
      const row = content.locator('tr.row').first();
      if (await row.count()) {
        await row.dblclick().catch(() => {});
        await page.waitForTimeout(100);
        const ok = content.getByRole('button', { name: 'OK', exact: true });
        if (await ok.count()) {
          await ok.first().click();
          await page.waitForTimeout(100);
          await errToast('Edit first row, OK');
          const ferr = content.locator('.form-err, .err-text');
          if ((await ok.count()) && (await ferr.count())) issues.push(`${where} / Edit first row, OK: ${(await ferr.first().innerText()).trim()}`);
          const cancel = content.getByRole('button', { name: 'Cancel', exact: true });
          if (await cancel.count()) await cancel.first().click();
        }
        await page.keyboard.press('Escape');
      }
      // 3. Create New opens a form (or a type menu) and Cancel closes it
      const create = content.getByRole('button', { name: /Create New/ }).first();
      if ((await create.count()) && (await create.isEnabled())) {
        await create.click();
        await page.waitForTimeout(100);
        const menu = page.locator('.dropdown-menu .mi').first();
        if (await menu.isVisible().catch(() => false)) await menu.click();
        const cancel = content.getByRole('button', { name: 'Cancel', exact: true });
        if (await cancel.count()) await cancel.first().click();
        await page.keyboard.press('Escape');
      }
      await errToast('end');
    }
  }
  return issues;
}

test('sweep every page on a factory unit', async ({ page, errors }) => {
  test.setTimeout(240_000);
  await freshLogin(page);
  const issues = await sweep(page, 'factory');
  console.log(issues.join('\n') || 'no issues');
  expect(issues).toEqual([]);
});

test('sweep every page on a busy unit (VPN, SD-WAN, BGP, OSPF, users, admin hardening)', async ({ page, errors }) => {
  test.setTimeout(300_000);
  await freshLogin(page);
  for (const id of ['l9-ldap', 'l11-sslvpn', 'l8-harden', 'l13-dynamic', 'l12-sdwan']) {
    await app(page, '/src/store.ts', 'startLab', id);
    await app(page, '/tests/solutions.ts', 'solve', id);
  }
  await app(page, '/src/store.ts', 'exitLab');
  await app(page, '/src/store.ts', 'navigate', 'dash-status', null);
  const issues = await sweep(page, 'busy');
  console.log(issues.join('\n') || 'no issues');
  expect(issues).toEqual([]);
});
