import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** WCAG 2.1 A and AA rules. Any violation fails the test with axe's own description. */
async function expectAccessible(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include) builder.include(include);
  const { violations } = await builder.analyze();
  expect(violations.map((violation) => `${violation.id}: ${violation.help} (${String(violation.nodes.length)})`)).toEqual([]);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('land, see a variant, join, cancel, and get counted in the results', async ({ page }) => {
  const errors = collectErrors(page);

  // Land: the hero renders one variant and reports its exposure.
  const exposure = page.waitForRequest((request) => (request.postDataJSON() as { operationName?: string } | null)?.operationName === 'LogExposure');
  await page.goto('/');
  const hero = page.getByTestId('hero');
  await expect(hero).toHaveAttribute('data-variant', /^(control|savings_calculator)$/);
  const variant = await hero.getAttribute('data-variant');
  await exposure;
  await expectAccessible(page);

  // Sign up for the monthly trial. A double click is harmless.
  await page.getByRole('link', { name: 'Start your 30-day free trial' }).click();
  await expect(page.getByRole('heading', { name: 'Join Crate Club' })).toBeVisible();
  await page.getByRole('radio', { name: /Monthly/ }).check();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Start free trial' }).dblclick();

  // The member page shows the trial.
  await expect(page).toHaveURL(/\/member$/);
  const status = page.getByTestId('membership-status');
  await expect(status).toHaveText('Free trial');
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Joined' })).toHaveCount(1);
  await expectAccessible(page);

  // Escape closes the dialog without cancelling, and focus goes back to the button.
  const cancelButton = page.getByRole('button', { name: 'Cancel membership' });
  await cancelButton.click();
  const dialog = page.getByRole('dialog', { name: 'Cancel Crate Club?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Keep my membership' })).toBeFocused();
  await expectAccessible(page, 'dialog');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(cancelButton).toBeFocused();
  await expect(status).toHaveText('Free trial');

  // Cancel for real.
  await cancelButton.click();
  await dialog.getByRole('button', { name: 'Yes, cancel' }).click();
  // Optimistic: the page says so at once, and focus moves to the page heading.
  await expect(status).toHaveText('Cancelled');
  await expect(page.getByRole('heading', { name: 'Your membership' })).toBeFocused();
  await expect(page.getByRole('link', { name: 'Rejoin Crate Club' })).toBeVisible();

  // The results page counts this visitor: one exposure and one conversion in their variant.
  await page.getByRole('link', { name: 'Experiments' }).click();
  const row = page.getByTestId('experiment-landing_hero').getByTestId(`variant-${String(variant)}`);
  await expect(row.getByTestId('exposures')).toHaveText('1');
  await expect(row.getByTestId('conversions')).toHaveText('1');
  await expect(page.getByTestId('experiment-landing_hero').getByTestId('verdict')).toContainText('Collecting data');
  // This journey's own page loads have reported Web Vitals by now.
  await expect(page.getByTestId('web-vitals').getByRole('listitem').first()).toBeVisible();
  await expectAccessible(page);

  expect(errors).toEqual([]);
});

test('a declined card is announced and creates no membership', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/join');
  await page.getByRole('radio', { name: /Annual/ }).check();
  await page.getByRole('radio', { name: /Demo card B/ }).check();
  await page.getByRole('button', { name: 'Join and pay $79' }).click();
  await expect(page.getByRole('alert')).toContainText('declined');
  await expectAccessible(page);

  await page.getByRole('radio', { name: /Demo card A/ }).check();
  await expect(page.getByRole('alert')).toBeHidden();
  await page.getByRole('button', { name: 'Join and pay $79' }).click();
  await expect(page.getByTestId('membership-status')).toHaveText('Active');
  expect(errors).toEqual([]);
});

test('starting over as a new visitor gives a fresh identity', async ({ page }) => {
  await page.goto('/');
  const id = page.getByTestId('visitor-id');
  const before = await id.textContent();
  await page.getByRole('button', { name: 'Start over as a new visitor' }).click();
  await expect(id).not.toHaveText(before ?? '');
  await page.getByRole('link', { name: 'My membership' }).click();
  await expect(page.getByText('You are not a member yet.')).toBeVisible();
});
