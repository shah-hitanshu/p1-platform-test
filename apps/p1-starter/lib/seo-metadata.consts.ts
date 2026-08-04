/**
 * The fixed vocabularies shared by the renderer and the editor.
 *
 * Next types `og:type` and `twitter:card` as unions rather than strings, so
 * buildPageMetadata validates against these lists and falls back rather than
 * letting an unrecognised value reach the tag. The Puck root config builds its
 * dropdown options from the same lists, so an option cannot offer a value the
 * renderer will reject.
 */

export const OG_TYPES = ["website", "article", "book", "profile"] as const;

export const TWITTER_CARDS = [
  "summary",
  "summary_large_image",
  "player",
  "app",
] as const;

export type OgType = (typeof OG_TYPES)[number];
export type TwitterCard = (typeof TWITTER_CARDS)[number];
