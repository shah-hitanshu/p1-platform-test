/**
 * End-to-end tests for the P1 editor shell.
 *
 * These run signed in (mock auth mode against the mock CCR server) so they can
 * exercise the editor itself rather than the sign-in gate.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  signIn,
  stampWindow,
  windowStampSurvives,
  stampElement,
  elementStampSurvives,
  startSampling,
  stopSampling,
} from './helpers/editor';

// The navigator lists whatever path the API returns, which may or may not
// carry a leading slash — match on the slug so either shape works.
const CONTACT_SLUG = 'contact-us';

async function openEditor(page: Page): Promise<void> {
  await signIn(page);
  await page.goto('/p1');
  await expect(page.getByTestId('p1-editor-header')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#preview-frame')).toBeAttached({ timeout: 30_000 });
}

async function switchToPage(page: Page, slug: string): Promise<void> {
  await page.getByTestId('page-selector').click();
  await page.getByTestId('page-navigator-item').filter({ hasText: slug }).first().click();
  await expect(page).toHaveURL(new RegExp(`/p1/${slug}$`));
}

test.describe('P1 Editor - page switching', () => {
  test('switching the active page navigates client-side without reloading the document', async ({
    page,
  }) => {
    await openEditor(page);

    await stampWindow(page);
    await switchToPage(page, CONTACT_SLUG);

    // A full refresh would replace the window object and wipe the stamp.
    expect(await windowStampSurvives(page)).toBe(true);
  });

  test('switching the active page keeps the canvas mounted', async ({ page }) => {
    await openEditor(page);

    await stampElement(page, '#preview-frame');

    await switchToPage(page, CONTACT_SLUG);

    // React tears down DOM nodes on unmount, so a surviving expando on the
    // canvas iframe means one Puck instance handled both pages — the iframe was
    // never rebuilt, which is what remounting Puck used to cost.
    expect(await elementStampSurvives(page, '#preview-frame')).toBe(true);
  });

  // Before the editor rendered from a persistent layout, a page switch tore the
  // whole subtree down — P1AuthProvider included — so the editor blanked to
  // "Authenticating..." and then "Loading editor..." before rebuilding. A 4x
  // CPU-throttled trace of the old behavior showed ~1.5s of blank page.
  test('switching the active page never blanks the editor to a loading state', async ({
    page,
  }) => {
    await openEditor(page);

    await startSampling(page);
    await switchToPage(page, CONTACT_SLUG);
    const samples = await stopSampling(page);

    expect(samples.length).toBeGreaterThan(0);
    // "Loading editor" is being renamed to "Loading document" (#142) — match
    // either so this keeps catching the blank whichever copy is in the build.
    const blanked = samples.filter((s) => /Authenticating|Loading (editor|document)/.test(s.text));
    expect(blanked).toEqual([]);
    expect(samples.filter((s) => !s.header)).toEqual([]);
  });

  test('switching the active page loads the new document into the canvas', async ({ page }) => {
    await openEditor(page);
    await switchToPage(page, CONTACT_SLUG);

    // The fixture's /contact-us document has a HeadingBlock titled "Heading ee".
    await expect(
      page.frameLocator('#preview-frame').getByText('Heading ee')
    ).toBeVisible({ timeout: 30_000 });
  });
});

// Regression coverage for PCC-3583: deleting a page goes through
// client.documents.delete() (css-client's BaseEndpoint), which sends
// Content-Type: application/json on every request including this bodyless
// DELETE — the exact shape that a backend body-presence bug rejected in
// production. This guards the delete flow itself (button -> confirm ->
// request -> page removed); the request/response contract that caused the
// regression is covered by the unit tests in
// workers/ccr/tests/routes/document-api.spec.ts, not here —
// the mock CCR server this suite runs against doesn't replicate the real
// backend's Content-Type validation.
test.describe('P1 Editor - delete page', () => {
  test('deleting a page removes it from the navigator', async ({ page, request }) => {
    const slug = 'e2e-delete-me';
    const created = await request.post(
      'http://localhost:4444/api/sites/test-site/branches/branch-main/documents',
      { data: { path: slug } }
    );
    expect(created.ok()).toBe(true);

    await openEditor(page);
    await switchToPage(page, slug);

    const splitButton = page.getByTestId('publish-split-button');
    await splitButton.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete page' }).click();

    const deleteResponse = page.waitForResponse(
      (res) => res.url().includes(`/documents/`) && res.request().method() === 'DELETE'
    );
    // The confirmation toast's button node gets replaced on every app re-render,
    // so by the time Playwright's remote click protocol re-resolves and dispatches,
    // the element it grabbed is already detached. Click it natively in one
    // synchronous browser-side step instead of round-tripping through Playwright's
    // multi-step actionability checks.
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Delete'
      );
      button?.click();
    });
    expect((await deleteResponse).ok()).toBe(true);

    await page.getByTestId('page-selector').click();
    await expect(
      page.getByTestId('page-navigator-item').filter({ hasText: slug })
    ).toHaveCount(0);
  });
});

// PCC-3928 added an in-canvas "reopen strip" so the right panel could be
// reopened after closing both side panels. The team later decided (following
// PCC-3928) that the strip was redundant with the top toolbar's own "Toggle
// right panel" button and cost reserved canvas real estate the team wants to
// avoid, so it was removed: the right panel now collapses fully to 0px, just
// like the left panel, and reopens only via the top toggle.
test.describe('P1 Editor - right panel toggle', () => {
  test('the right panel collapses fully and reopens via the top toggle', async ({ page }) => {
    // Wide enough that useResponsivePanels' own auto-collapse budget (1308px)
    // doesn't close anything on our behalf — every collapse below is deliberate.
    await page.setViewportSize({ width: 1600, height: 900 });
    await openEditor(page);

    // A test id alone isn't unique here: Puck mounts all four left plugin tabs
    // at once and hides the inactive ones with CSS, so the inspector renders
    // into its mobile Fields tab as well as the right sidebar. Only the right
    // sidebar's inspector is on screen, so visibility picks out the live one.
    const rightCollapseButton = page
      .getByTestId('inspector-collapse-button')
      .filter({ visible: true });
    const toggleRightPanelButton = page.getByRole('button', { name: 'Toggle right panel' });

    await expect(rightCollapseButton).toBeVisible();
    await rightCollapseButton.click();

    // No in-canvas reopen affordance remains — the panel collapses to 0px like
    // the left panel does, with no strip reserving any width for it.
    await expect(rightCollapseButton).toBeHidden();
    await expect(page.getByTestId('inspector-reopen-button')).toHaveCount(0);

    await toggleRightPanelButton.click();
    await expect(rightCollapseButton).toBeVisible();
  });
});
