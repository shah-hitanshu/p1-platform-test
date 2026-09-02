import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

interface StoryIndex {
  entries: Record<string, { id: string; type: string; title: string; name: string }>;
}

const indexPath = join(import.meta.dirname, '..', 'storybook-static', 'index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8')) as StoryIndex;
const stories = Object.values(index.entries).filter((entry) => entry.type === 'story');

test('the story index is not empty', () => {
  expect(stories.length).toBeGreaterThan(0);
});

for (const story of stories) {
  test(`${story.title} — ${story.name}`, async ({ page }) => {
    await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
    // Storybook sets this once the story has mounted; without it the first
    // screenshots race the render and produce noisy diffs.
    await page.waitForSelector('#storybook-root > *', { state: 'attached' });
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`${story.id}.png`, {
      fullPage: true,
      animations: 'disabled',
      maxDiffPixelRatio: 0.001,
    });
  });
}
