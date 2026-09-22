// @vitest-environment node
/**
 * Reads the stylesheet as PuckEditorTheme.test.ts does, pinning the values taken
 * from the design rather than how they are written.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { AGENT_FADE_MS } from '../src/collaboration/utils/agentBlockHosts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const stylesPath = join(__dirname, '..', 'src', 'styles.css');

function readStyles(): string {
  return readFileSync(stylesPath, 'utf-8');
}

describe('agent overlay: the rim', () => {
  it('runs the aurora band along the edge, three times the box, over 1.5s', () => {
    const css = readStyles();

    expect(css).toMatch(
      /--agent-aurora:\s*linear-gradient\(115deg, #7c5cfc 0%, #4fa8ff 33%, #ff6fb0 66%, #7c5cfc 100%\)/,
    );
    expect(css).toMatch(/--agent-flow:\s*1\.5s/);
    expect(css).toMatch(
      /\.focus-region-agent-host::before\s*\{[^}]*background-size:\s*300% 300%[^}]*\}/,
    );
    expect(css).toMatch(
      /@keyframes focus-region-agent-flow\s*\{(?:[^{}]*\{[^}]*\})*?\s*to\s*\{\s*background-position:\s*100% 50%/,
    );
  });

  it('draws the rim 2px wide on the block’s own radius', () => {
    const css = readStyles();

    expect(css).toMatch(/\.focus-region-agent-host\s*\{[^}]*border-radius:\s*6px[^}]*\}/);
    expect(css).toMatch(
      /\.focus-region-agent-host::before\s*\{[^}]*padding:\s*var\(--agent-frame\)[^}]*\}/,
    );
    expect(css).toMatch(/--agent-frame:\s*2px/);
    // A square rim on a rounded block leaves the corners showing through.
    expect(css).toMatch(/\.focus-region-agent-host::before\s*\{[^}]*border-radius:\s*inherit[^}]*\}/);
  });
});

describe('agent overlay: the badge', () => {
  it('is a 32px disc behind a white keyline', () => {
    const css = readStyles();

    expect(css).toMatch(/\.focus-region-agent__avatar\s*\{[^}]*width:\s*32px[^}]*\}/);
    expect(css).toMatch(/\.focus-region-agent__avatar\s*\{[^}]*background:\s*#141414[^}]*\}/);
    // A spread shadow, not a border, so the keyline takes no room from the disc.
    expect(css).toMatch(/\.focus-region-agent__avatar\s*\{[^}]*box-shadow:\s*0 0 0 2px #fff[^}]*\}/);
    expect(css).toMatch(
      /\.focus-region-agent__avatar \.focus-region-agent__icon\s*\{[^}]*width:\s*14px[^}]*\}/,
    );
  });

  it('rings the badge with the rim’s own gradient, outside the keyline', () => {
    const css = readStyles();

    // 32 + 2×2 keyline + 2×2 ring = 40px, so the ring starts where the keyline ends.
    expect(css).toMatch(/\.focus-region-agent__avatar::after\s*\{[^}]*inset:\s*-4px[^}]*\}/);
    expect(css).toMatch(
      /\.focus-region-agent__avatar::after\s*\{[^}]*background-image:\s*var\(--agent-aurora\)[^}]*\}/,
    );
    expect(css).toMatch(
      /\.focus-region-agent__avatar::after\s*\{[^}]*animation:\s*focus-region-agent-flow var\(--agent-flow\) linear infinite/,
    );
  });
});

describe('agent overlay: the name pill', () => {
  it('is legible without the reader finding the badge first', () => {
    const css = readStyles();

    expect(css).not.toMatch(/\.focus-region-agent__name\s*\{[^}]*opacity:\s*0[^}]*\}/);
    expect(css).not.toMatch(/\.focus-region-agent__avatar:hover \+ \.focus-region-agent__name/);
  });

  it('reads as the design draws it: a darker sweep, white, 500, 13px, 8px corners', () => {
    const css = readStyles();

    expect(css).toMatch(
      /\.focus-region-agent__name\s*\{[^}]*background-image:\s*linear-gradient\(115deg, #5b3fe0 0%, #2f7fd8 33%, #c7427f 66%, #5b3fe0 100%\)/,
    );
    expect(css).toMatch(/\.focus-region-agent__name\s*\{[^}]*font-weight:\s*500[^}]*\}/);
    expect(css).toMatch(/\.focus-region-agent__name\s*\{[^}]*font-size:\s*13px[^}]*\}/);
    expect(css).toMatch(/\.focus-region-agent__name\s*\{[^}]*padding:\s*6px 14px[^}]*\}/);
    expect(css).toMatch(/\.focus-region-agent__name\s*\{[^}]*border-radius:\s*8px[^}]*\}/);
  });

  it('sweeps on the same clock as the rim and the badge’s ring', () => {
    const css = readStyles();

    expect(css).toMatch(/\.focus-region-agent__name\s*\{[^}]*background-size:\s*300% 300%[^}]*\}/);
    expect(css).toMatch(
      /\.focus-region-agent__name\s*\{[^}]*animation:\s*focus-region-agent-flow var\(--agent-flow\) linear infinite/,
    );
  });
});

describe('agent overlay: reduced motion', () => {
  it('holds all three gradients still for a reader who asks for less motion', () => {
    const css = readStyles();

    for (const selector of [
      '\\.focus-region-agent-host::before',
      '\\.focus-region-agent__avatar::after',
      '\\.focus-region-agent__name',
    ]) {
      expect(css).toMatch(
        new RegExp(
          `@media \\(prefers-reduced-motion: reduce\\)\\s*\\{(?:[^{}]*\\{[^}]*\\})*?\\s*${selector}\\s*\\{[^}]*animation:\\s*none`,
        ),
      );
    }
  });
});

describe('agent overlay: the banner', () => {
  it('waits to be asked for', () => {
    const css = readStyles();

    expect(css).toMatch(/\.focus-region-agent__banner\s*\{[^}]*opacity:\s*0[^}]*\}/);
    expect(css).toMatch(/\.focus-region-agent__banner\s*\{[^}]*pointer-events:\s*none[^}]*\}/);
  });

  it('answers to focus as well as to a click', () => {
    const css = readStyles();

    expect(css).toMatch(
      /\.focus-region-agent-host:focus-within \.focus-region-agent__banner[^{]*\{[^}]*opacity:\s*1/,
    );
    expect(css).toMatch(/\.focus-region-agent-host\[data-selected\] \.focus-region-agent__banner/);
  });

  it('sits in the block’s top-right on a fixed near-black ground', () => {
    const css = readStyles();

    expect(css).toMatch(/\.focus-region-agent__banner\s*\{[^}]*top:\s*8px[^}]*\}/);
    expect(css).toMatch(/\.focus-region-agent__banner\s*\{[^}]*right:\s*8px[^}]*\}/);
    expect(css).toMatch(/\.focus-region-agent__banner\s*\{[^}]*border-radius:\s*8px[^}]*\}/);
    expect(css).toMatch(
      /\.focus-region-agent__banner\s*\{[^}]*background:\s*oklch\(0\.2046 0 0\)[^}]*\}/,
    );
  });

  it('divides Stop from the label with a hairline rather than a gap', () => {
    const css = readStyles();

    expect(css).toMatch(
      /\.focus-region-agent__stop\s*\{[^}]*border-left:\s*1px solid rgb\(255 255 255 \/ 16%\)/,
    );
  });
});

describe('agent overlay: the shimmer', () => {
  it('slides a covering layer rather than moving a box across', () => {
    const css = readStyles();

    expect(css).not.toMatch(/\.focus-region-agent__shimmer::(before|after)\s*\{[^}]*transform:/);
    expect(css).toMatch(
      /\.focus-region-agent__shimmer::before,\s*\.focus-region-agent__shimmer::after\s*\{[^}]*background-size:\s*3600px 3600px[^}]*\}/,
    );
    expect(css).toMatch(
      /@keyframes focus-region-agent-sheen\s*\{(?:[^{}]*\{[^}]*\})*?\s*to\s*\{\s*background-position-y:\s*-20%/,
    );
    expect(css).toMatch(/--agent-sheen:\s*2\.7s/);
  });

  it('runs a second band half a cycle behind the first', () => {
    const css = readStyles();

    expect(css).toMatch(
      /\.focus-region-agent__shimmer::before\s*\{[^}]*animation-delay:\s*calc\(var\(--agent-sheen\) \/ -2\)[^}]*\}/,
    );
  });

  it('is clipped to the block\u2019s own corners', () => {
    const css = readStyles();

    expect(css).toMatch(/\.focus-region-agent__shimmer\s*\{[^}]*border-radius:\s*inherit[^}]*\}/);
    expect(css).toMatch(/\.focus-region-agent__shimmer\s*\{[^}]*overflow:\s*hidden[^}]*\}/);
  });

  it('passes under the rim rather than washing over it', () => {
    const css = readStyles();

    expect(css).toMatch(/\.focus-region-agent__shimmer\s*\{[^}]*z-index:\s*-1[^}]*\}/);
  });

  it('holds still for a reader who asks for less motion', () => {
    const css = readStyles();

    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{(?:[^{}]*\{[^}]*\})*?\s*\.focus-region-agent__shimmer::before,\s*\.focus-region-agent__shimmer::after\s*\{[^}]*animation:\s*none/,
    );
  });
});

describe('agent overlay: the fade', () => {
  it('runs its whole ramp rather than easing from wherever it sat', () => {
    const css = readStyles();

    expect(css).toMatch(/@keyframes focus-region-agent-out\s*\{(?:[^{}]*\{[^}]*\})*?\s*to\s*\{\s*opacity:\s*0/);
    expect(css).not.toMatch(
      /\.focus-region-agent-host\[data-leaving\]\s*\{[^}]*transition:/,
    );
    expect(css).toMatch(
      /\.focus-region-agent-host\[data-leaving\]\s*\{[^}]*animation:\s*focus-region-agent-out var\(--agent-fade\) linear forwards/,
    );
  });

  it('fades over the same span the host map waits for', () => {
    const css = readStyles();

    const declared = /--agent-fade:\s*([\d.]+)s/.exec(css);
    expect(declared).not.toBeNull();
    expect(Number(declared?.[1]) * 1000).toBe(AGENT_FADE_MS);
  });

  it('is gone at once for a reader who asks for less motion', () => {
    const css = readStyles();

    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{(?:[^{}]*\{[^}]*\})*?\s*\.focus-region-agent-host\[data-leaving\]\s*\{[^}]*opacity:\s*0/,
    );
  });
});

describe('agent overlay: the clip', () => {
  it('cuts the overlay to the page’s viewport rather than the editor’s', () => {
    const css = readStyles();

    // The fallback lets the marker hang before anything has been measured.
    expect(css).toMatch(
      /\.focus-region-agent-host\s*\{[^}]*clip-path:\s*inset\(\s*var\(--agent-clip-top, -20px\) 0 var\(--agent-clip-bottom, 0px\) 0\s*\)/,
    );
  });
});

describe('agent overlay: where it sits in the pile', () => {
  it('stays under the editor’s own controls', () => {
    const css = readStyles();

    expect(css).toMatch(/\.focus-region-agent-host\s*\{[^}]*z-index:\s*0;/);
  });

  it('is still a stacking context of its own', () => {
    const css = readStyles();

    expect(css).not.toMatch(/\.focus-region-agent-host\s*\{[^}]*z-index:\s*auto/);
    expect(css).toMatch(/\.focus-region-agent__shimmer\s*\{[^}]*z-index:\s*-1/);
  });
});

describe('agent overlay: in the page, and in the gutter', () => {
  it('hangs the overlays from the page’s own origin', () => {
    const css = readStyles();

    expect(css).toMatch(/\.focus-region-agent-layer\s*\{[^}]*position:\s*absolute[^}]*\}/);
    expect(css).toMatch(/\.focus-region-agent-layer\s*\{[^}]*top:\s*0[^}]*\}/);
    expect(css).toMatch(/\.focus-region-agent-layer\s*\{[^}]*left:\s*0[^}]*\}/);
  });

  it('stacks the overlays above the editor’s own layers in the page', () => {
    const css = readStyles();

    expect(css).toMatch(/\.focus-region-agent-layer\s*\{[^}]*z-index:\s*3[^}]*\}/);
  });

  it('draws a marker the gutter carries only once', () => {
    const css = readStyles();

    expect(css).toMatch(
      /\.focus-region-agent-host\[data-gutter-marker\] \.focus-region-agent__marker\s*\{[^}]*display:\s*none[^}]*\}/,
    );
  });

  it('draws only the marker in the gutter, leaving the rim to the page', () => {
    const css = readStyles();

    expect(css).toMatch(/\.focus-region-agent-host\[data-gutter\]::before\s*\{[^}]*content:\s*none[^}]*\}/);
  });
});

describe('agent overlay: at the editor’s size in a zoomed page', () => {
  it('draws the rim 2px wide on screen', () => {
    const css = readStyles();

    expect(css).toMatch(
      /\.focus-region-agent-layer > \.focus-region-agent-host::before\s*\{[^}]*padding:\s*calc\(var\(--agent-frame\) \* var\(--agent-unzoom, 1\)\)[^}]*\}/,
    );
  });

  it('draws the marker at its own size, still astride the edge', () => {
    const css = readStyles();

    expect(css).toMatch(
      /\.focus-region-agent-layer \.focus-region-agent__marker\s*\{[^}]*transform:\s*translateY\(-50%\) scale\(var\(--agent-unzoom, 1\)\)[^}]*\}/,
    );
    expect(css).toMatch(
      /\.focus-region-agent-layer \.focus-region-agent__marker\s*\{[^}]*transform-origin:\s*left center[^}]*\}/,
    );
  });

  it('draws the banner at its own size, from its corner', () => {
    const css = readStyles();

    expect(css).toMatch(
      /\.focus-region-agent-layer \.focus-region-agent__banner\s*\{[^}]*transform:\s*scale\(var\(--agent-unzoom, 1\)\)[^}]*\}/,
    );
    expect(css).toMatch(
      /\.focus-region-agent-layer \.focus-region-agent__banner\s*\{[^}]*transform-origin:\s*top right[^}]*\}/,
    );
  });

  // A fixed cut would clip the marker once it is scaled up.
  it('does not cut an overlay in the page', () => {
    const css = readStyles();

    expect(css).toMatch(
      /\.focus-region-agent-layer > \.focus-region-agent-host\s*\{[^}]*clip-path:\s*none[^}]*\}/,
    );
  });
});

describe('agent overlay: the banner beside the editor’s own toolbar', () => {
  it('stands as tall as the toolbar', () => {
    const css = readStyles();

    expect(css).toMatch(/\.focus-region-agent__banner\s*\{[^}]*padding:\s*4px 0;[^}]*\}/);
    expect(css).toMatch(/\.focus-region-agent__stop\s*\{[^}]*min-height:\s*28px[^}]*\}/);
    expect(css).toMatch(/\.focus-region-agent__banner\s*\{[^}]*line-height:\s*18px[^}]*\}/);
  });

  it('sets its words in the toolbar’s face, size and weight', () => {
    const css = readStyles();

    expect(css).toMatch(
      /\.focus-region-agent__banner\s*\{[^}]*font-family:\s*var\(--puck-font-family, 'Inter Tight', Inter, system-ui, sans-serif\)[^}]*\}/,
    );
    expect(css).toMatch(/\.focus-region-agent__banner\s*\{[^}]*font-size:\s*12px[^}]*\}/);
    expect(css).toMatch(/\.focus-region-agent__banner\s*\{[^}]*font-weight:\s*500[^}]*\}/);
  });

  it('colours its words and icons the toolbar’s grey', () => {
    const css = readStyles();

    expect(css).toMatch(
      /\.focus-region-agent__banner\s*\{[^}]*color:\s*var\(--puck-color-grey-08, #c3c3c3\)[^}]*\}/,
    );
  });

  it('starts its words where the toolbar starts its label', () => {
    const css = readStyles();

    expect(css).toMatch(/\.focus-region-agent__label\s*\{[^}]*margin-inline:\s*4px[^}]*\}/);
    expect(css).toMatch(/\.focus-region-agent__label\s*\{[^}]*padding:\s*0 8px[^}]*\}/);
  });
});
