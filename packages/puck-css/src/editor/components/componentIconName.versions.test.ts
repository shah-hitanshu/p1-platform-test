/**
 * Icon resolution across pds-toolkit versions.
 *
 * pds-toolkit's icon set is not stable and its Icon throws on a name it does
 * not ship — an uncaught throw in an outline row unmounts the editor, and it
 * repeats on every load of any document holding that block. A published site
 * pinning a pds-toolkit where `link` had become `linkSimple` and `squareDashed`
 * was gone is what took the Button block down, so both shapes are pinned here.
 *
 * Each case re-imports the module because it reads the icon set once at load.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

async function loadWith(iconList: unknown) {
  vi.resetModules();
  vi.doMock('@pantheon-systems/pds-toolkit-react', () => ({ iconList }));
  return import('./componentIconName.js');
}

describe('getIconForComponent across pds-toolkit icon sets', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@pantheon-systems/pds-toolkit-react');
  });

  describe('a pds-toolkit that renamed link and dropped squareDashed', () => {
    const RENAMED = [
      'text', 'image', 'grid', 'rectangleList', 'quotesLeft', 'minus',
      'expand', 'house', 'billboard', 'memo', 'sitemap', 'table', 'code',
      'inputText', 'video', 'linkSimple', 'squareMinus',
    ];

    it('resolves ButtonBlock to linkSimple rather than the missing link', async () => {
      const { getIconForComponent } = await loadWith(RENAMED);
      expect(getIconForComponent('ButtonBlock')).toBe('linkSimple');
    });

    it('resolves an unmatched type to squareMinus rather than the missing squareDashed', async () => {
      const { getIconForComponent } = await loadWith(RENAMED);
      expect(getIconForComponent('TestimonialCarousel')).toBe('squareMinus');
    });

    it('never returns a name the set does not ship, for any block type', async () => {
      const { getIconForComponent } = await loadWith(RENAMED);
      const shipped = new Set(RENAMED);
      for (const type of [
        'ButtonBlock', 'HeadingBlock', 'ImageBlock', 'GridBlock', 'ListBlock',
        'QuoteBlock', 'DividerBlock', 'SpacerBlock', 'P1WelcomeBlock',
        'HeroBlock', 'LinkListBlock', 'PricingTable', 'CardDeck',
        'SomeEntirelyUnknownConsumerBlock',
      ]) {
        const icon = getIconForComponent(type);
        if (icon !== null) expect(shipped.has(icon)).toBe(true);
      }
    });
  });

  describe('a pds-toolkit shipping neither candidate', () => {
    it('returns null so the caller renders no icon', async () => {
      const { getIconForComponent } = await loadWith(['text', 'image']);
      expect(getIconForComponent('ButtonBlock')).toBeNull();
      expect(getIconForComponent('WhateverBlock')).toBeNull();
    });

    it('still resolves the types it does ship', async () => {
      const { getIconForComponent } = await loadWith(['text', 'image']);
      expect(getIconForComponent('HeadingBlock')).toBe('text');
    });
  });

  describe('a pds-toolkit that does not export iconList at all', () => {
    // Nothing to check against, so the preferred name goes through unchecked
    // and SafeIcon absorbs it if the glyph is gone.
    it('falls back to the preferred candidate', async () => {
      const { getIconForComponent } = await loadWith(undefined);
      expect(getIconForComponent('ButtonBlock')).toBe('link');
      expect(getIconForComponent('TestimonialCarousel')).toBe('squareDashed');
    });
  });
});
