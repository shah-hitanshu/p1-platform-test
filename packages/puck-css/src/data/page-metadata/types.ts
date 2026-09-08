/**
 * The shape stored at `root.props._meta`, and the fixed vocabularies two of its
 * fields are checked against.
 */

/**
 * Authored page metadata. Empty means inherit: a blank field resolves from the
 * page's own title/description at render time rather than having been copied
 * when the page was created.
 */
export interface PageMetaFields {
  ogTitle?: string;
  ogDescription?: string;
  ogType?: string;
  ogImage?: string;
  ogLocale?: string;
  twitterCard?: string;
  twitterTitle?: string;
  twitterImage?: string;
}

export type OgType = "website" | "article" | "book" | "profile";
export type TwitterCard = "summary" | "summary_large_image" | "player" | "app";
