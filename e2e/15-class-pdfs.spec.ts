import { test, expect, freshLogin } from './helpers';
import { LABS } from '../src/labs/labs';
import { classPdf, COURSE_PLAN_PDF } from '../src/labs/classes';

/** The link opens in a new tab and serves a real PDF (not the app's index.html). */
async function expectPdf(request: import('@playwright/test').APIRequestContext, href: string | null) {
  expect(href, 'link has an href').toBeTruthy();
  const res = await request.get(href!);
  expect(res.status(), href!).toBe(200);
  expect(res.headers()['content-type'], href!).toContain('application/pdf');
  expect((await res.body()).subarray(0, 5).toString(), href!).toBe('%PDF-');
}

test('Training links the course plan and a class PDF for every lab', async ({ page, request, errors }) => {
  await freshLogin(page);
  await page.getByTitle('Labs & Challenges').click();
  await expect(page.locator('.page-title', { hasText: 'Labs & Challenges' })).toBeVisible();

  const plan = page.getByRole('link', { name: 'Course plan (PDF)' });
  await expect(plan).toHaveAttribute('href', COURSE_PLAN_PDF);
  await expect(plan).toHaveAttribute('target', '_blank');
  await expectPdf(request, await plan.getAttribute('href'));

  const links = page.getByRole('link', { name: 'Class PDF' });
  await expect(links).toHaveCount(LABS.length);
  for (const lab of LABS) {
    const link = page.locator(`#lab-card-${lab.id}`).getByRole('link', { name: 'Class PDF' });
    await expect(link).toHaveAttribute('href', classPdf(lab.id)!);
    await expect(link).toHaveAttribute('target', '_blank');
    await expectPdf(request, await link.getAttribute('href'));
  }
});

test('the Lab Guide links the class PDF of the running lab', async ({ page, request, errors }) => {
  await freshLogin(page);
  await page.getByTitle('Labs & Challenges').click();
  await page.locator('#lab-card-l2-first-policy').getByRole('button', { name: /Start/ }).click();
  const backup = page.locator('.modal .toggle.on');
  if (await backup.isVisible().catch(() => false)) await backup.click(); // no backup download
  await page.getByRole('button', { name: 'Start lab' }).click();
  const link = page.locator('.lab-guide').getByRole('link', { name: 'Open the class PDF' });
  await expect(link).toHaveAttribute('href', classPdf('l2-first-policy')!);
  await expect(link).toHaveAttribute('target', '_blank');
  await expectPdf(request, await link.getAttribute('href'));
});
