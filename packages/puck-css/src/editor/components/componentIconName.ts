/**
 * getIconForComponent
 *
 * Picks a PDS icon for a Puck component so an outline row is scannable by
 * shape, not just by reading every label.
 *
 * Tokenizes both the component type and its human-readable label into
 * whole-word tokens, then matches against BY_KEYWORD. Whole-token matching
 * prevents false positives (e.g. "blacklist" does not match keyword "list").
 *
 * pds-toolkit's icon set is not stable across releases and consumers pin their
 * own version, so each keyword lists its candidates in preference order and we
 * take the first the installed set actually ships. Returns null when it ships
 * none of them; callers must render no icon rather than pass the name on.
 */

import { iconList } from '@pantheon-systems/pds-toolkit-react';

const AVAILABLE: ReadonlySet<string> = new Set<string>(
  Array.isArray(iconList) ? (iconList as string[]) : [],
);

/** Generic block outline, used when nothing else matches. */
const FALLBACK = ['squareDashed', 'squareMinus'];

/**
 * Keyword → icon candidates, checked in order against the component's token set.
 * Order matters as a tiebreaker when a name contains two matching keywords.
 */
const BY_KEYWORD: [string, string[]][] = [
  ['image', ['image']],
  ['photo', ['image']],
  ['video', ['video']],
  ['media', ['image']],
  ['heading', ['text']],
  ['title', ['text']],
  ['paragraph', ['memo']],
  ['text', ['text']],
  ['quote', ['quotesLeft']],
  ['list', ['rectangleList']],
  ['table', ['table']],
  ['grid', ['grid']],
  ['divider', ['minus']],
  ['spacer', ['expand']],
  ['button', ['link', 'linkSimple']],
  ['link', ['link', 'linkSimple']],
  ['card', FALLBACK],
  ['code', ['code']],
  ['form', ['inputText']],
  ['hero', ['billboard']],
  ['banner', ['billboard']],
  ['footer', ['sitemap']],
  ['header', ['sitemap']],
  ['welcome', ['house']],
];

/**
 * A pds-toolkit that does not export `iconList` tells us nothing about what it
 * ships, so the preferred name goes through unchecked and SafeIcon absorbs it
 * if the glyph turns out to be gone.
 */
function firstAvailable(candidates: string[]): string | null {
  if (AVAILABLE.size === 0) return candidates[0] ?? null;
  return candidates.find((name) => AVAILABLE.has(name)) ?? null;
}

/** Split a PascalCase/camelCase or space-separated string into lowercase tokens. */
function tokenize(s: string): string[] {
  return [
    ...new Set(
      s
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .split(/[^a-zA-Z]+/)
        .map((t) => t.toLowerCase())
        .filter(Boolean),
    ),
  ];
}

// TODO: when the API for registering consumer components on a site is
// finalized, consider accepting an optional consumer-supplied type→icon map
// here so custom components can opt into a precise icon without relying on
// keyword inference.
export function getIconForComponent(type: string, label?: string): string | null {
  const tokens = new Set([...tokenize(type), ...(label ? tokenize(label) : [])]);

  for (const [keyword, candidates] of BY_KEYWORD) {
    if (tokens.has(keyword)) return firstAvailable(candidates);
  }

  return firstAvailable(FALLBACK);
}
