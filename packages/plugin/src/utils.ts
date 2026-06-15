export interface ImageTransformParams {
  width?: number;
  height?: number;
  format?: "webp" | "jpeg" | "png" | "gif" | "avif";
  quality?: number;
}

/**
 * Merges Imagor transform params onto a CDN image URL.
 * Preserves any existing params in the URL (e.g. smart=true set by the editor).
 *
 * @example
 * buildImageUrl(data.heroImage, { width: 1200, height: 630, format: "webp" })
 */
export function buildImageUrl(url: string, params: ImageTransformParams): string {
  if (!url) return url;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return url;
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) {
      parsed.searchParams.set(k, String(v));
    }
  }
  return parsed.toString();
}
