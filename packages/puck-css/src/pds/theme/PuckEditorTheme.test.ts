/**
 * Tests for PuckEditorTheme.css
 *
 * Verifies that the CSS file contains the correct --puck-* to --pds-*
 * variable mappings that retheme Puck's native chrome using PDSv2 tokens.
 *
 * Strategy: read the CSS file directly via fs — the mappings are a static
 * authoring concern, not runtime behaviour, so content assertions are the
 * right layer of confidence here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const p1Path = join(__dirname, 'PuckEditorTheme.css');

function readThemeCSS(): string {
  return readFileSync(p1Path, 'utf-8');
}

describe('PuckEditorTheme.css', () => {
  it('exists and is non-empty', () => {
    const css = readThemeCSS();
    expect(css.length).toBeGreaterThan(0);
  });

  it('applies all mappings within the .puck-editor-theme scope class', () => {
    const css = readThemeCSS();
    expect(css).toContain('.puck-editor-theme');
  });

  describe('neutral color mappings', () => {
    it('maps --puck-color-white to PDS background default', () => {
      const css = readThemeCSS();
      expect(css).toContain('--puck-color-white');
      expect(css).toContain('var(--pds-color-bg-default)');
    });

    it('maps --puck-color-black to PDS foreground default', () => {
      const css = readThemeCSS();
      expect(css).toContain('--puck-color-black');
      expect(css).toContain('var(--pds-color-fg-default)');
    });
  });

  describe('grey scale mappings', () => {
    it('maps --puck-color-grey-01 to PDS secondary background', () => {
      const css = readThemeCSS();
      expect(css).toContain('--puck-color-grey-01');
      expect(css).toContain('var(--pds-color-bg-default-secondary)');
    });

    it('maps --puck-color-grey-03 to PDS default border', () => {
      const css = readThemeCSS();
      expect(css).toContain('--puck-color-grey-03');
      expect(css).toContain('var(--pds-color-border-default)');
    });

    it('maps --puck-color-grey-05 to PDS input border', () => {
      const css = readThemeCSS();
      expect(css).toContain('--puck-color-grey-05');
      expect(css).toContain('var(--pds-color-border-input)');
    });

    it('maps --puck-color-grey-09 to PDS secondary foreground', () => {
      const css = readThemeCSS();
      expect(css).toContain('--puck-color-grey-09');
      expect(css).toContain('var(--pds-color-fg-default-secondary)');
    });

    it('maps --puck-color-grey-11 to PDS foreground default', () => {
      const css = readThemeCSS();
      expect(css).toContain('--puck-color-grey-11');
      expect(css).toContain('var(--pds-color-fg-default)');
    });

    it('uses an oklch fallback for grey-02 (no direct PDS token)', () => {
      const css = readThemeCSS();
      expect(css).toContain('--puck-color-grey-02');
      expect(css).toMatch(/--puck-color-grey-02:\s*oklch/);
    });

    it('uses an oklch fallback for grey-04 (no direct PDS token)', () => {
      const css = readThemeCSS();
      expect(css).toContain('--puck-color-grey-04');
      expect(css).toMatch(/--puck-color-grey-04:\s*oklch/);
    });
  });

  describe('interactive color mappings', () => {
    it('maps --puck-color-azure-04 to PDS foreground default (not purple interactive-link)', () => {
      const css = readThemeCSS();
      expect(css).toContain('--puck-color-azure-04');
      // PDS v2 interactive-link-default is purple — we intentionally map to
      // fg-default (near-black) to avoid purple in the UI.
      expect(css).toContain('--puck-color-azure-04: var(--pds-color-fg-default)');
    });

    it('maps --puck-color-azure-05 to PDS foreground default (not purple interactive-link)', () => {
      const css = readThemeCSS();
      expect(css).toContain('--puck-color-azure-05');
      expect(css).toContain('--puck-color-azure-05: var(--pds-color-fg-default)');
    });
  });

  describe('status color mappings', () => {
    it('maps --puck-color-rose-04 to PDS critical foreground', () => {
      const css = readThemeCSS();
      expect(css).toContain('--puck-color-rose-04');
      expect(css).toContain('var(--pds-color-status-critical-foreground)');
    });

    it('maps --puck-color-green-04 to PDS success foreground', () => {
      const css = readThemeCSS();
      expect(css).toContain('--puck-color-green-04');
      expect(css).toContain('var(--pds-color-status-success-foreground)');
    });
  });

  describe('typography mappings', () => {
    it('maps --puck-font-family to PDS default font family', () => {
      const css = readThemeCSS();
      expect(css).toContain('--puck-font-family');
      expect(css).toContain('var(--pds-typography-ff-default)');
    });

    it('maps --puck-font-family-monospaced to PDS code font family', () => {
      const css = readThemeCSS();
      expect(css).toContain('--puck-font-family-monospaced');
      expect(css).toContain('var(--pds-typography-ff-code)');
    });
  });
});
