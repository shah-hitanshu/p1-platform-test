/**
 * End-to-end tests for the p1-starter app.
 *
 * Runs against the Next.js app backed by a mock CCR API server.
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

    // .first(): ParagraphBlock renders the text inside a div.rich-text wrapper
    // that the client adds on hydration, so the string matches both the wrapper
    // and its <p>. Without this the assertion is a strict-mode violation as soon
    // as hydration wins the race — which it does on a warm dev server.
    await expect(
      page.getByText('Build and manage pages with the visual editor').first()
    ).toBeVisible();
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

  // Not just cosmetic: the route is statically renderable, so a 200 here would
  // write every URL a crawler probes into the response cache as a success and
  // let it be indexed.
  test('unknown paths respond 404, not a soft 404', async ({ request }) => {
    const response = await request.get('/this-page-does-not-exist');
    expect(response.status()).toBe(404);
  });

  test('a published page still responds 200', async ({ request }) => {
    const response = await request.get('/contact-us');
    expect(response.status()).toBe(200);
  });
});

/**
 * The fixture seeds a real document at /_registry/components/Hero, so these
 * assert the denylist rather than mere absence: the backend genuinely holds
 * that content and the site still must not serve it. The check lives in the
 * SDK's loadPublishedPage, not in the app's route files.
 */
test.describe('P1 Starter - Internal document namespaces', () => {
  test('a seeded registry document is not routable', async ({ request }) => {
    const response = await request.get('/_registry/components/Hero');
    expect(response.status()).toBe(404);
  });

  test('registry content never reaches the page', async ({ page }) => {
    await page.goto('/_registry/components/Hero');
    await expect(page.getByText('INTERNAL REGISTRY DOCUMENT')).toHaveCount(0);
  });

  // Prefix matching is on segment boundaries: /_registry-guide shares the
  // reserved word but is a real page, and must still be reachable.
  test('a page that only shares a prefix is still served', async ({ page }) => {
    const response = await page.goto('/_registry-guide');
    expect(response?.status()).toBe(200);
    await expect(page.getByText('How our registry works')).toBeVisible();
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
