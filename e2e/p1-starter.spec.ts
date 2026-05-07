/**
 * End-to-end tests for the p1-starter app.
 *
 * Runs against the Next.js app backed by a mock CSS API server.
 * The mock seeds page data from e2e/fixtures/database.json and exposes
 * pages at "/" and "/contact-us".
 */

import { test, expect } from '@playwright/test';

test.describe('P1 Starter - Home Page', () => {
  test('displays welcome heading and navigation links', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'Welcome to the P1 Starter Kit' })
    ).toBeVisible();

    await expect(
      page.getByRole('link', { name: 'Open the Page Editor' })
    ).toHaveAttribute('href', '/p1');
  });

  test('lists pages from the database', async ({ page }) => {
    await page.goto('/');

    const contactLink = page.getByRole('link', { name: '/contact-us' });
    await expect(contactLink).toBeVisible();
    await expect(contactLink).toHaveAttribute('href', '/contact-us');
  });
});

test.describe('P1 Starter - Public Pages', () => {
  test('renders the contact-us page with content from database', async ({ page }) => {
    await page.goto('/contact-us');

    // The fixture has a HeadingBlock with title "Heading ee" at /contact-us
    await expect(page.getByText('Heading ee')).toBeVisible();
  });

  test('shows 404 page for unknown paths', async ({ page }) => {
    await page.goto('/this-page-does-not-exist');

    await expect(
      page.getByText("This page hasn't been created")
    ).toBeVisible();

    // Should offer a link to edit the page
    await expect(
      page.getByRole('link', { name: 'Edit this page' })
    ).toBeVisible();
  });
});

test.describe('P1 Starter - Editor Dashboard', () => {
  test('shows sign-in gate when not authenticated', async ({ page }) => {
    await page.goto('/p1');

    // AuthGate blocks access when no auth tokens are present
    await expect(page.getByText('Sign in required')).toBeVisible();
  });

  test('page title is set to P1 Dashboard', async ({ page }) => {
    await page.goto('/p1');

    await expect(page).toHaveTitle('P1 Dashboard');
  });
});
