import { describe, it, expect } from 'vitest';
import { getIconForComponent } from './componentIconName.js';

describe('getIconForComponent', () => {
  // ── Former BY_TYPE entries — must resolve via generic token path ──────────
  it.each([
    ['HeadingBlock',     'text'],
    ['ParagraphBlock',   'memo'],
    ['QuoteBlock',       'quotesLeft'],
    ['ListBlock',        'rectangleList'],
    ['ImageBlock',       'image'],
    ['MediaFigureBlock', 'image'],
    ['GridBlock',        'grid'],
    ['DividerBlock',     'minus'],
    ['SpacerBlock',      'expand'],
    ['ButtonBlock',      'link'],
    ['P1WelcomeBlock',   'house'],
  ])('%s → %s (type-only)', (type, expected) => {
    expect(getIconForComponent(type)).toBe(expected);
  });

  // ── Unknown types — keyword hit via type name ─────────────────────────────
  it('PricingTable → table via keyword in type', () => {
    expect(getIconForComponent('PricingTable')).toBe('table');
  });

  it('HeroCarousel → billboard via "hero" keyword in type', () => {
    expect(getIconForComponent('HeroCarousel')).toBe('billboard');
  });

  // ── Unknown types — no keyword → fallback ────────────────────────────────
  it('TestimonialCarousel → squareDashed (no keyword match)', () => {
    expect(getIconForComponent('TestimonialCarousel')).toBe('squareDashed');
  });

  // ── Label provides the signal the type name lacks ────────────────────────
  it('P1Block + label "Welcome" → house', () => {
    expect(getIconForComponent('P1Block', 'Welcome')).toBe('house');
  });

  it('CustomBlock + label "Hero Section" → billboard', () => {
    expect(getIconForComponent('CustomBlock', 'Hero Section')).toBe('billboard');
  });

  // ── Token boundary: "blacklist" must NOT match keyword "list" ────────────
  it('BlacklistBlock → squareDashed (blacklist is one token, not list)', () => {
    expect(getIconForComponent('BlacklistBlock')).toBe('squareDashed');
  });

  // ── label is optional — single-arg call still works ──────────────────────
  it('ImageBlock with no label still resolves correctly', () => {
    expect(getIconForComponent('ImageBlock')).toBe('image');
  });
});
