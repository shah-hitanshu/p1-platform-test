/** Default field names that the P1 media picker treats as image sources. */
export const DEFAULT_MEDIA_FIELD_PATTERNS = [
  /^image(?:Url)?$/,
  /^logo(?:Url)?$/,
  /^media(?:Url)?$/,
  /^icon(?:Url)?$/,
  /^thumbnail(?:Url)?$/,
  /ImageUrl$/,
  /LogoUrl$/,
];

export function isDefaultMediaFieldName(name: string): boolean {
  return DEFAULT_MEDIA_FIELD_PATTERNS.some((pattern) => pattern.test(name));
}
