/**
 * Tests for getInitials — the collaborator-avatar label.
 *
 * Returning '' for an unusable name is load-bearing: callers use it to decide
 * whether to render initials or fall back to the PDS user icon, so an empty
 * circle is never rendered.
 */

import { describe, it, expect } from 'vitest';
import { getInitials } from './initials.js';

describe('getInitials', () => {
  it('takes the first letter of the first and last word, uppercased', () => {
    expect(getInitials('Marco Reyes')).toBe('MR');
    expect(getInitials('Ana Maria Reyes')).toBe('AR'); // middle names skipped
    expect(getInitials('marco reyes')).toBe('MR');
    expect(getInitials('  Marco   Reyes  ')).toBe('MR');
    // Naive name[0] would emit a lone surrogate and render a replacement box.
    expect(getInitials('𐐀nna Smith')).toBe('𐐀S');
  });

  it('returns a single initial for a one-word name', () => {
    expect(getInitials('Alice')).toBe('A');
  });

  it('treats a compound surname as a single word', () => {
    expect(getInitials('Jane Doe-Smith')).toBe('JD');
    expect(getInitials('Mary-Jane Watson')).toBe('MW');
    expect(getInitials('Jean-Luc Picard')).toBe('JP');
    expect(getInitials('Ana Maria Doe-Smith')).toBe('AD');
    expect(getInitials("Sinead O'Connor")).toBe('SO');
    expect(getInitials('Jane Doe - Smith')).toBe('JS');
    expect(getInitials('Doe-Smith')).toBe('D');
  });

  it('skips words that do not start with a letter, keeping the rest', () => {
    expect(getInitials('Alice Smith (Contractor)')).toBe('AS');
    expect(getInitials('Support Team 2')).toBe('ST');
    expect(getInitials('Ana *Reyes')).toBe('A');
    expect(getInitials('Alice (Contractor)')).toBe('A');
    expect(getInitials('2 Support')).toBe('S');
  });

  it('returns an empty string when there is no usable name', () => {
    expect(getInitials('')).toBe('');
    expect(getInitials('   ')).toBe('');
    expect(getInitials(undefined)).toBe('');
    expect(getInitials(null)).toBe('');
    // Punctuation-only names would otherwise yield junk like ".." or "??",
    // which is non-empty and so would skip the icon fallback.
    expect(getInitials('???')).toBe('');
    expect(getInitials('...')).toBe('');
    expect(getInitials('--- ---')).toBe('');
    expect(getInitials('(Contractor)')).toBe('');
    expect(getInitials('2 3 4')).toBe('');
  });
});
