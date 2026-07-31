/**
 * humanizeComponentName
 *
 * Derives a human-readable label from a Puck component key for display in the
 * visual component sidebar. Callers should prefer a component's explicit
 * `label` when one exists and fall back to this for the raw key.
 *
 * Transform: strip a trailing "Block" suffix, split PascalCase (and
 * digit→capital boundaries) into words, and upper-case known acronyms.
 *
 *   "HeroBlock"        -> "Hero"
 *   "CardGridBlock"    -> "Card Grid"
 *   "P1WelcomeBlock"   -> "P1 Welcome"
 *   "CtaBannerBlock"   -> "CTA Banner"
 *   "FaqBlock"         -> "FAQ"
 */

/** Words (lower-cased) that should render fully upper-cased. */
const ACRONYMS: Record<string, string> = {
  cta: 'CTA',
  faq: 'FAQ',
};

export function humanizeComponentName(name: string): string {
  return name
    .replace(/Block$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ACRONYMS[word.toLowerCase()] ?? word)
    .join(' ');
}
