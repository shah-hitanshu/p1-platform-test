/**
 * Default field name patterns that trigger the media library picker.
 * Targets image/logo/icon source fields while excluding navigation URLs
 * (buttonUrl, linkUrl, ctaUrl, etc.) and alt text fields.
 */
export const DEFAULT_MEDIA_PATTERNS = [
  /^image(?:Url)?$/,
  /^logo(?:Url)?$/,
  /^media(?:Url)?$/,
  /^icon(?:Url)?$/,
  /^thumbnail(?:Url)?$/,
  /ImageUrl$/,
  /LogoUrl$/,
];
