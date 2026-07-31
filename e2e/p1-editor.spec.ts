/**
 * End-to-end tests for the P1 editor shell.
 *
 * These run signed in (mock auth mode against the mock CSS server) so they can
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
