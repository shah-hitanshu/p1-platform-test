import { describe, expect, it } from 'vitest';
import { P1_ASSETS, P1_FALLBACKS } from './assets';

describe('P1_ASSETS', () => {
  it('every placeholder is an absolute URL under p1_placeholders/', () => {
    for (const url of Object.values(P1_ASSETS)) {
      expect(new URL(url).pathname).toMatch(/^\/p1_placeholders\/[a-z0-9_-]+\.jpg$/);
    }
  });

  it('has an inline SVG fallback for every asset', () => {
    expect(Object.keys(P1_FALLBACKS).sort()).toEqual(Object.keys(P1_ASSETS).sort());
    for (const svg of Object.values(P1_FALLBACKS)) expect(svg).toMatch(/^data:image\/svg\+xml,/);
  });
});
