// The entry point `@pantheon-systems/puck-css/seo` resolves to. The deep
// modules are not in the package's `exports`, so this is the public surface:
// the head renderer takes the types and vocabularies, the editor takes the
// field set.

export type { PageMetaFields, OgType, TwitterCard } from "./types.js";
export {
  OG_TYPES,
  TWITTER_CARDS,
  DEFAULT_EDITOR_ROOT_TITLE,
} from "./consts.js";
export { createSeoRootFields } from "./root-fields.js";
