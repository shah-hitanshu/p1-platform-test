import { describe, it, expect } from 'vitest';
import { wireframe } from './define-meta';

describe('wireframe', () => {
  it('is a self-contained data URI, not a network URL', () => {
    expect(wireframe(800, 600)).toMatch(/^data:image\/svg\+xml,/);
  });

  it('decodes to valid SVG carrying the requested dimensions', () => {
    const svg = decodeURIComponent(wireframe(1200, 675).replace('data:image/svg+xml,', ''));
    expect(svg).toContain('viewBox="0 0 1200 675"');
    expect(svg).toContain('d="M0 675L1200 0"');
    expect(svg).not.toMatch(/NaN|undefined|\d\.\d{6}/);
  });
});
