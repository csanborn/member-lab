import { expect, test } from '@playwright/test';

test('results page screenshot', async ({ page }) => {
  await page.goto('/experiments');
  await expect(page.getByTestId('experiment-signup_default_plan').getByTestId('verdict')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshot.png', fullPage: true });
});
