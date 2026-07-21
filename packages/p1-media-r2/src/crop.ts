// Crop param helpers shared by the basic (string) and rich (p1-media) fields.
// Crop lives in the URL query so the stored value stays a plain CDN URL.

export type CropMode = "fit" | "smart" | "custom";

/** A manual crop region in source-image pixels (the Worker's `trim.*` params). */
export interface TrimRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function getBaseUrl(value: string): string {
  return value ? value.split("?")[0] : "";
}

function getParams(value: string): URLSearchParams {
  return new URLSearchParams(value.includes("?") ? value.split("?")[1] : "");
}

export function getCropMode(value: string): CropMode {
  if (!value) return "fit";
  const params = getParams(value);
  if (params.has("trim.left")) return "custom";
  return params.get("fit") === "cover" ? "smart" : "fit";
}

/** Reads the manual crop region off a value URL, or null when absent/malformed. */
export function getTrimRect(value: string): TrimRect | null {
  if (!value) return null;
  const params = getParams(value);
  const read = (key: string): number | null => {
    const raw = params.get(key);
    if (raw === null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const left = read("trim.left");
  const top = read("trim.top");
  const width = read("trim.width");
  const height = read("trim.height");
  if (left === null || top === null || width === null || height === null) return null;
  return { left, top, width, height };
}

/**
 * Builds a value URL for a preset crop mode. `custom` is not a preset — it
 * intentionally degrades to fit-in here, because callers reach this either
 * from the fit/smart buttons (never "custom") or when carrying the current
 * mode onto a NEWLY selected asset, where the old image's trim rect would be
 * meaningless.
 */
export function buildValueWithCrop(baseUrl: string, crop: CropMode): string {
  // baseUrl always has query params stripped by getBaseUrl before being passed here
  return crop === "smart"
    ? `${baseUrl}?fit=cover&gravity=auto`
    : `${baseUrl}?fit=scale-down`;
}

/**
 * Builds a value URL carrying a manual crop region. Values are rounded to
 * integers and clamped to a ≥1px region at a non-negative offset — the Worker
 * passes them straight to Cloudflare Images, which rejects degenerate rects.
 */
export function buildValueWithTrim(baseUrl: string, rect: TrimRect): string {
  const left = Math.max(0, Math.round(rect.left));
  const top = Math.max(0, Math.round(rect.top));
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  return `${baseUrl}?trim.left=${left}&trim.top=${top}&trim.width=${width}&trim.height=${height}`;
}
