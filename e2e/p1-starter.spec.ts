/**
 * End-to-end tests for the p1-starter app.
 *
 * Runs against the Next.js app backed by a mock CSS API server.
 * The mock seeds page data from e2e/fixtures/database.json and exposes
 * pages at "/" and "/contact-us".
 */

import { test, expect } from '@playwright/test';

test.describe('P1 Starter - Home Page', () => {
  test('displays welcome heading and editor link from Puck blocks', async ({ page }) => {
    await page.goto('/');

    // HeadingBlock renders the welcome heading
    await expect(
      page.getByRole('heading', { name: 'Welcome to P1 Starter Kit' })
    ).toBeVisible();

    // ButtonBlock renders as a clickable link
    const editorLink = page.getByRole('link', { name: 'Open Page Editor' });
    await expect(editorLink).toBeVisible();
    await expect(editorLink).toHaveAttribute('href', '/p1');
  });

  test('renders the homepage document from the database', async ({ page }) => {
    await page.goto('/');

    // ParagraphBlock renders the description text from the fixture
    await expect(page.getByText('Build and manage pages with the visual editor')).toBeVisible();
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

test.describe('P1 Starter - Editor', () => {
  test('shows sign-in gate when not authenticated', async ({ page }) => {
    await page.goto('/p1');

    // AuthGate blocks access when no auth tokens are present
    await expect(page.getByText('Your Collaborative Website Management Workspace.')).toBeVisible();
  });

  test('page title is set to P1 Editor', async ({ page }) => {
    await page.goto('/p1');

    await expect(page).toHaveTitle('P1 Editor: /');
  });
});
