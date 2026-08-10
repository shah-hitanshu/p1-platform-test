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
 * Every name here exists in @pantheon-systems/pds-toolkit-react's icon set.
 * An unknown iconName renders nothing at all, so verify before adding one.
 */

/** Generic block outline, used when nothing else matches. */
const FALLBACK = 'squareDashed';

/**
 * Keyword → icon, checked in order against the component's token set.
 * Order matters as a tiebreaker when a name contains two matching keywords.
 */
const BY_KEYWORD: [string, string][] = [
  ['image', 'image'],
  ['photo', 'image'],
  ['video', 'video'],
  ['media', 'image'],
  ['heading', 'text'],
  ['title', 'text'],
  ['paragraph', 'memo'],
  ['text', 'text'],
  ['quote', 'quotesLeft'],
  ['list', 'rectangleList'],
  ['table', 'table'],
  ['grid', 'grid'],
  ['divider', 'minus'],
  ['spacer', 'expand'],
  ['button', 'link'],
  ['link', 'link'],
  ['card', 'squareDashed'],
  ['code', 'code'],
  ['form', 'inputText'],
  ['hero', 'billboard'],
  ['banner', 'billboard'],
  ['footer', 'sitemap'],
  ['header', 'sitemap'],
  ['welcome', 'house'],
];

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
export function getIconForComponent(type: string, label?: string): string {
  const tokens = new Set([...tokenize(type), ...(label ? tokenize(label) : [])]);

  for (const [keyword, icon] of BY_KEYWORD) {
    if (tokens.has(keyword)) return icon;
  }

  return FALLBACK;
}
