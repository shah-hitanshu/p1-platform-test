import { describe, expect, it } from 'vitest';

import {
  isUnsafeKey,
  isComponentNode,
  stripTrailingSlash,
  PATH_REGEX,
  isReservedPath,
  hasStaticAssetExtension,
  normalizePath,
} from '../../data/paths';

describe('isUnsafeKey', () => {
  it('rejects prototype-pollution keys', () => {
    expect(isUnsafeKey('__proto__')).toBe(true);
    expect(isUnsafeKey('constructor')).toBe(true);
    expect(isUnsafeKey('prototype')).toBe(true);
  });

  it('allows normal keys', () => {
    expect(isUnsafeKey('title')).toBe(false);
    expect(isUnsafeKey('id')).toBe(false);
    expect(isUnsafeKey('')).toBe(false);
  });
});

describe('isComponentNode', () => {
  it('returns true for valid component nodes', () => {
    expect(isComponentNode({ type: 'Text', props: { id: '1' } })).toBe(true);
  });

  it('returns false for non-objects', () => {
    expect(isComponentNode(null)).toBe(false);
    expect(isComponentNode(undefined)).toBe(false);
    expect(isComponentNode('string')).toBe(false);
    expect(isComponentNode(42)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isComponentNode([{ type: 'X', props: {} }])).toBe(false);
  });

  it('returns false when type is not a string', () => {
    expect(isComponentNode({ type: 123, props: {} })).toBe(false);
  });

  it('returns false when props is not an object', () => {
    expect(isComponentNode({ type: 'X', props: null })).toBe(false);
    expect(isComponentNode({ type: 'X', props: 'nope' })).toBe(false);
  });
});

describe('stripTrailingSlash', () => {
  it('removes trailing slash', () => {
    expect(stripTrailingSlash('/about/')).toBe('/about');
  });

  it('preserves root path', () => {
    expect(stripTrailingSlash('/')).toBe('/');
  });

  it('defaults empty to /', () => {
    expect(stripTrailingSlash('')).toBe('/');
  });

  it('leaves non-trailing-slash paths alone', () => {
    expect(stripTrailingSlash('/about')).toBe('/about');
  });
});

describe('PATH_REGEX', () => {
  it('matches valid paths', () => {
    expect(PATH_REGEX.test('/about')).toBe(true);
    expect(PATH_REGEX.test('/jedi/1')).toBe(true);
    expect(PATH_REGEX.test('/test/:a/:b')).toBe(true);
    expect(PATH_REGEX.test('/a-b_c.d')).toBe(true);
  });

  it('rejects invalid paths', () => {
    expect(PATH_REGEX.test('/')).toBe(false);
    expect(PATH_REGEX.test('')).toBe(false);
    expect(PATH_REGEX.test('about')).toBe(false);
    expect(PATH_REGEX.test('/about?q=1')).toBe(false);
  });
});

describe('isReservedPath', () => {
  it('detects reserved prefixes', () => {
    expect(isReservedPath('/p1')).toBe(true);
    expect(isReservedPath('/p1/edit')).toBe(true);
    expect(isReservedPath('/puck')).toBe(true);
    expect(isReservedPath('/_next')).toBe(true);
  });

  it('allows non-reserved paths', () => {
    expect(isReservedPath('/about')).toBe(false);
    expect(isReservedPath('/contact')).toBe(false);
    expect(isReservedPath('/structure')).toBe(false);
  });
});

describe('hasStaticAssetExtension', () => {
  it('detects asset extensions', () => {
    expect(hasStaticAssetExtension('/logo.png')).toBe(true);
    expect(hasStaticAssetExtension('/assets/app.min.js')).toBe(true);
    expect(hasStaticAssetExtension('/fonts/inter.woff2')).toBe(true);
    expect(hasStaticAssetExtension('/hero.WEBP')).toBe(true);
  });

  it('leaves page paths alone', () => {
    expect(hasStaticAssetExtension('/about')).toBe(false);
    expect(hasStaticAssetExtension('/')).toBe(false);
    expect(hasStaticAssetExtension('/blog/2026/launch')).toBe(false);
  });

  it('treats dots in slugs as part of the slug', () => {
    expect(hasStaticAssetExtension('/dr.smith')).toBe(false);
    expect(hasStaticAssetExtension('/v1.2-release-notes')).toBe(false);
  });

  it('leaves legacy-CMS extensions routable so their redirects still resolve', () => {
    expect(hasStaticAssetExtension('/old-page.html')).toBe(false);
    expect(hasStaticAssetExtension('/index.php')).toBe(false);
    expect(hasStaticAssetExtension('/legacy.aspx')).toBe(false);
    expect(hasStaticAssetExtension('/brochure.pdf')).toBe(false);
  });

  it('ignores a leading dot on a dotfile-style segment', () => {
    expect(hasStaticAssetExtension('/.well-known/thing')).toBe(false);
  });

  it('detects asset extensions behind trailing slashes', () => {
    expect(hasStaticAssetExtension('/logo.png/')).toBe(true);
    expect(hasStaticAssetExtension('/assets/app.min.js//')).toBe(true);
  });

  it('stays linear on long slash runs', () => {
    const slashes = '/'.repeat(200_000);
    expect(hasStaticAssetExtension(`/logo.png${slashes}`)).toBe(true);

    const started = performance.now();
    expect(hasStaticAssetExtension(`${slashes}x`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('normalizePath', () => {
  it('normalizes valid paths', () => {
    expect(normalizePath('/about/')).toBe('/about');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('  /contact  ')).toBe('/contact');
  });

  it('returns null for reserved paths', () => {
    expect(normalizePath('/p1/edit')).toBeNull();
    expect(normalizePath('/_next/data')).toBeNull();
  });

  it('returns null for static-asset paths so writes match the read path', () => {
    expect(normalizePath('/press-kit.svg')).toBeNull();
    expect(normalizePath('/logo.png/')).toBeNull();
    expect(normalizePath('/old-page.html')).toBe('/old-page.html');
  });

  it('normalizes non-string inputs to root', () => {
    expect(normalizePath('')).toBe('/');
    expect(normalizePath(42)).toBe('/');
    expect(normalizePath(null)).toBe('/');
  });
});
