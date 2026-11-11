import { expect, test } from '@playwright/test';

test('results page screenshot', async ({ page }) => {
  await page.goto('/experiments');
  await expect(page.getByTestId('experiment-signup_default_plan').getByTestId('verdict')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshot.png', fullPage: true });
});

test('landing and member page previews', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByTestId('hero')).toHaveAttribute('data-variant', /.+/);
  await page.screenshot({ path: testInfo.outputPath('landing.png'), fullPage: true });
  await page.goto('/join');
  await page.getByRole('radio', { name: /Monthly/ }).check();
  await page.screenshot({ path: testInfo.outputPath('join.png'), fullPage: true });
  await page.getByRole('button', { name: 'Start free trial' }).click();
  await expect(page.getByTestId('membership-status')).toHaveText('Free trial');
  await page.screenshot({ path: testInfo.outputPath('member.png'), fullPage: true });
});
