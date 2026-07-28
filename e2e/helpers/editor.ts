/**
 * Helpers for editor E2E tests: mock-mode sign-in plus stamps that detect
 * whether a navigation reloaded the document or remounted a component.
 */

import type { Page } from '@playwright/test';

const TOKEN_STORAGE_KEY = 'p1_auth_token';
const MOCK_TOKEN = 'mock-token-11111111-1111-1111-1111-111111111111';
const WINDOW_STAMP = '__p1E2EStamp';
const ELEMENT_STAMP = '__p1E2EStamp';

/**
 * Seed the token the mock server's /api/auth/me accepts, so P1AuthProvider
 * resolves as authenticated on first render. Must run before navigating.
 */
export async function signIn(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, token }) => {
      localStorage.setItem(key, token);
    },
    { key: TOKEN_STORAGE_KEY, token: MOCK_TOKEN }
  );
}

export async function stampWindow(page: Page): Promise<void> {
  await page.evaluate((key) => {
    (window as unknown as Record<string, unknown>)[key] = true;
  }, WINDOW_STAMP);
}

export async function windowStampSurvives(page: Page): Promise<boolean> {
  return page.evaluate(
    (key) => (window as unknown as Record<string, unknown>)[key] === true,
    WINDOW_STAMP
  );
}

/**
 * Poll the page while an interaction runs, so states that appear and vanish
 * between assertions are still observed. A remount of the editor is only
 * visible for a few hundred milliseconds on a fast machine.
 */
export async function startSampling(page: Page, intervalMs = 25): Promise<void> {
  await page.evaluate((ms) => {
    const w = window as unknown as Record<string, unknown>;
    clearInterval(w.__p1E2ESampler as number | undefined);
    const samples: { text: string; header: boolean }[] = [];
    w.__p1E2ESamples = samples;
    w.__p1E2ESampler = setInterval(() => {
      samples.push({
        text: document.body.innerText ?? '',
        header: !!document.querySelector('[data-testid="p1-editor-header"]'),
      });
    }, ms);
  }, intervalMs);
}

export async function stopSampling(
  page: Page
): Promise<{ text: string; header: boolean }[]> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    clearInterval(w.__p1E2ESampler as number | undefined);
    return (w.__p1E2ESamples ?? []) as { text: string; header: boolean }[];
  });
}

export async function stampElement(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().evaluate((el, key) => {
    (el as unknown as Record<string, unknown>)[key] = true;
  }, ELEMENT_STAMP);
}

export async function elementStampSurvives(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().evaluate(
    (el, key) => (el as unknown as Record<string, unknown>)[key] === true,
    ELEMENT_STAMP
  );
}
