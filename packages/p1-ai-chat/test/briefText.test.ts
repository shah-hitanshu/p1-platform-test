import { describe, it, expect } from 'vitest';
import { htmlToText } from '../src/lib/attachments/briefText.js';

describe('htmlToText', () => {
  it('reads the text a page says, not its markup', () => {
    const text = htmlToText('<h1>Pricing</h1><p>Three <strong>simple</strong> tiers.</p>');

    expect(text).toBe('Pricing\n\nThree simple tiers.');
  });

  // A heading that reaches the agent as the paragraph's first line reads as prose, not a
  // heading — so the structure of a brief has to survive being flattened.
  it('keeps a blank line between blocks, and one line per list item', () => {
    const text = htmlToText('<h2>Tiers</h2><ul><li>Free</li><li>Pro</li></ul><p>Call us.</p>');

    expect(text).toBe('Tiers\n\nFree\nPro\n\nCall us.');
  });

  // Otherwise a page's stylesheet and analytics arrive as though they were the brief.
  it('drops what is not prose', () => {
    const text = htmlToText(`
      <style>.a { color: red }</style>
      <script>trackEverything()</script>
      <p>Real copy.</p>
      <noscript>Turn on JavaScript</noscript>
    `);

    expect(text).toBe('Real copy.');
  });

  it('collapses the whitespace markup leaves behind', () => {
    const text = htmlToText('<p>  spaced   out  </p>\n\n\n<p>\tand tabbed</p>');

    expect(text).toBe('spaced out\n\nand tabbed');
  });

  // Reported by the caller as "this file has no text in it", which is the useful message.
  it('finds nothing in a page with nothing to say', () => {
    expect(htmlToText('<div><span></span></div>')).toBe('');
    expect(htmlToText('')).toBe('');
  });
});
