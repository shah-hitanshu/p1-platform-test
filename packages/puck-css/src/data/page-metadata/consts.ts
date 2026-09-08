import type { OgType, TwitterCard } from "./types.js";

/**
 * The fixed vocabularies shared by the renderer and the editor.
 *
 * `og:type` and `twitter:card` are typed as unions rather than strings by the
 * head-metadata renderer, which validates against these lists and falls back
 * rather than letting an unrecognised value reach the tag. The editor dropdowns
 * are built from the same lists, so an option cannot offer a value the renderer
 * will reject.
 */
export const OG_TYPES = ["website", "article", "book", "profile"] as const satisfies readonly OgType[];

export const TWITTER_CARDS = [
  "summary",
  "summary_large_image",
  "player",
  "app",
] as const satisfies readonly TwitterCard[];

/**
 * The root title an untitled page carries, from the root config's
 * `defaultProps`. Both the editor placeholders and the rendered head tags
 * refuse to treat it as a real value, so they share the constant rather than
 * each holding a copy.
 */
export const DEFAULT_EDITOR_ROOT_TITLE = "My Puck Editor";
