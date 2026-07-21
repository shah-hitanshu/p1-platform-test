/**
 * A library item — the Worker's MediaAsset shape (frozen contract). `metadata`
 * is a FLAT string map that INCLUDES `alt`; `width`/`height` are top-level
 * captured dimensions. `assetId`/`versionId` are absent only when pointed at a
 * pre-cutover Worker, in which case selection falls back to a string value (R10).
 */
export interface MediaItem {
  assetId?: string;
  versionId?: string;
  url: string;
  filename: string;
  contentType?: string;
  size?: number;
  width?: number;
  height?: number;
  metadata?: Record<string, string>;
  metaSchemaVersion?: number;
  createdAt?: string;
}

/** Normalizes one raw MediaAsset entry into a MediaItem. */
export function normalizeItem(raw: Record<string, unknown>): MediaItem {
  let metadata = raw.metadata as Record<string, string> | undefined;
  if (typeof metadata === "string") {
    // Defensive: the contract sends an object, but tolerate a JSON string.
    try {
      metadata = JSON.parse(metadata);
    } catch {
      metadata = undefined;
    }
  }
  return {
    assetId: raw.assetId as string | undefined,
    versionId: raw.versionId as string | undefined,
    url: String(raw.url ?? ""),
    filename: String(raw.filename ?? ""),
    contentType: raw.contentType as string | undefined,
    size: raw.size as number | undefined,
    width: raw.width as number | undefined,
    height: raw.height as number | undefined,
    metadata: metadata && typeof metadata === "object" ? metadata : undefined,
    metaSchemaVersion: raw.metaSchemaVersion as number | undefined,
    createdAt: raw.createdAt as string | undefined,
  };
}

/** `GET /media` returns a bare JSON array of MediaAsset (frozen contract). */
export function parseMediaList(data: unknown): MediaItem[] {
  if (!Array.isArray(data)) return [];
  return data.map((r) => normalizeItem(r as Record<string, unknown>));
}
