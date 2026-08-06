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

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

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

    it('maps --puck-color-grey-03 to PDS secondary foreground', () => {
      const css = readThemeCSS();
      expect(css).toMatch(
        /--puck-color-grey-03:\s*var\(--pds-color-fg-default-secondary\)/,
      );
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

  describe('canvas layout', () => {
    it('reveals the canvas grey background as a gutter via padding', () => {
      const css = readThemeCSS();
      // Matches only the outer _PuckCanvas_ element (children use a hyphen).
      expect(css).toMatch(/\[class\*="_PuckCanvas_"\]\s*\{[^}]*padding:\s*8px/);
    });

    it('rounds and clips the inner page (_PuckCanvas-root_)', () => {
      const css = readThemeCSS();
      expect(css).toMatch(
        /\[class\*="_PuckCanvas-root_"\]\s*\{[^}]*border-radius:\s*8px[^}]*overflow:\s*hidden/,
      );
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

  describe('editor chrome text/background reset (PCC-3456)', () => {
    it('pins an explicit light foreground and background on .puck-editor-theme itself', () => {
      const css = readThemeCSS();
      // Must be the bare `.puck-editor-theme` selector (not an attribute-scoped
      // descendant), so `color` inherits down to every chrome element that
      // declares no color of its own (e.g. @puckeditor/core's _DrawerItem-name_).
      expect(css).toMatch(
        /(?<![^\s{};])\.puck-editor-theme\s*\{[^}]*color:\s*var\(--pds-color-fg-default[^)]*\)[^}]*background:\s*var\(--pds-color-bg-default[^)]*\)[^}]*\}/,
      );
    });

    it('reserves the sidebar scrollbar gutter so expanding a field group does not reflow', () => {
      const css = readThemeCSS();
      // The sidebar is the scroll container, so an arriving scrollbar reclaims
      // its width and shifts every field. Reserving the gutter is what keeps a
      // collapsible field group from moving the panel when it expands.
      expect(css).toMatch(
        /\.puck-editor-theme \[class\*="_Sidebar"\]\s*\{[^}]*scrollbar-gutter:\s*stable[^}]*\}/,
      );
    });

    it('does not use a bare body selector, which would leak into the preview iframe', () => {
      const css = readThemeCSS();
      // The preview iframe renders its own <body>. Because this stylesheet is a
      // real <style>/<link> tag that Puck's collectStyles() copies into that
      // iframe, a bare `body { ... }` rule here would match the iframe's body
      // directly and force every previewed page into this light theme.
      // Strip comments first — the file's explanatory comments intentionally
      // quote a `body { ... }` example of what NOT to do.
      const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(cssWithoutComments).not.toMatch(/(^|\s|\})body\s*\{/);
    });
  });
});
