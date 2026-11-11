import { expect, test } from '@playwright/test';

test('results page screenshot', async ({ page }) => {
  // Visit a few pages first so the Web Vitals panel has field data from this browser.
  for (const path of ['/', '/join', '/member', '/']) {
    await page.goto(path);
    await page.getByRole('heading', { level: 1 }).first().waitFor();
  }
  await page.goto('/experiments');
  await expect(page.getByTestId('experiment-signup_default_plan').getByTestId('verdict')).toBeVisible();
  await expect(page.getByTestId('web-vitals').getByRole('listitem').first()).toBeVisible();
  await page.screenshot({ path: 'docs/screenshot.png', fullPage: true });
});
