import { describe, it, expect } from 'vitest';

import { humanizeComponentName } from './humanizeComponentName.js';

describe('humanizeComponentName', () => {
  it('strips a trailing "Block" suffix', () => {
    expect(humanizeComponentName('HeadingBlock')).toBe('Heading');
    expect(humanizeComponentName('HeroBlock')).toBe('Hero');
  });

  it('splits PascalCase into spaced words', () => {
    expect(humanizeComponentName('CardGridBlock')).toBe('Card Grid');
    expect(humanizeComponentName('FeatureMediaBlock')).toBe('Feature Media');
    expect(humanizeComponentName('LogoCloudBlock')).toBe('Logo Cloud');
  });

  it('inserts a space between a digit and a following capital', () => {
    expect(humanizeComponentName('P1WelcomeBlock')).toBe('P1 Welcome');
  });

  it('upper-cases known acronyms', () => {
    expect(humanizeComponentName('CtaBannerBlock')).toBe('CTA Banner');
    expect(humanizeComponentName('FaqBlock')).toBe('FAQ');
  });

  it('leaves a name without a "Block" suffix intact', () => {
    expect(humanizeComponentName('Hero')).toBe('Hero');
  });

  it('returns an empty string for empty or suffix-only input', () => {
    expect(humanizeComponentName('')).toBe('');
    expect(humanizeComponentName('Block')).toBe('');
  });
});
