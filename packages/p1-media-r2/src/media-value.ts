import type { MediaFieldValue, MediaValue } from "./types";
import {
  buildValueWithCrop,
  buildValueWithTrim,
  getBaseUrl,
  type CropMode,
  type TrimRect,
} from "./crop";

/**
 * Structural keys on a MediaValue that are not schema-driven metadata. Used to
 * avoid clobbering identity fields when copying metadata defaults into a value.
 */
export const STRUCTURAL_MEDIA_KEYS = new Set([
  "assetId",
  "versionId",
  "url",
  "metaSchemaVersion",
]);

/** Narrows a MediaFieldValue to the rich object form. */
export function isMediaValue(
  value: MediaFieldValue | null | undefined,
): value is MediaValue {
  return typeof value === "object" && value !== null;
}

/**
 * Builds the value the `p1-media` field writes on asset selection.
 *
 * R10 invariant: never synthesize a MediaValue unless BOTH `assetId` and
 * `versionId` are present — otherwise fall back to a bare URL string (basic
 * mode). A value with undefined identity is unfindable by "update usages" and
 * can render `src=undefined`, so this fallback is load-bearing, not cosmetic.
 * It also means picking from a pre-upgrade Worker (bare-array `GET /media`, no
 * assetId) yields a string, so the plugin degrades cleanly before the cutover.
 */
export function makeMediaValue(input: {
  assetId?: string | null;
  versionId?: string | null;
  url: string;
  metaSchemaVersion?: number;
  metadata?: Record<string, string | number | undefined>;
}): MediaFieldValue {
  if (!input.assetId || !input.versionId) {
    return input.url; // R10 fallback: string value
  }
  const value: MediaValue = {
    assetId: input.assetId,
    versionId: input.versionId,
    url: input.url,
  };
  if (typeof input.metaSchemaVersion === "number") {
    value.metaSchemaVersion = input.metaSchemaVersion;
  }
  if (input.metadata) {
    for (const [k, v] of Object.entries(input.metadata)) {
      if (v === undefined || v === "") continue;
      if (STRUCTURAL_MEDIA_KEYS.has(k)) continue; // never let metadata clobber identity
      value[k] = v;
    }
  }
  return value;
}

/** The asset fields the field editor needs to build a value on selection. */
export interface SelectableAsset {
  assetId?: string | null;
  versionId?: string | null;
  url: string;
  width?: number;
  height?: number;
  metadata?: Record<string, string>;
  metaSchemaVersion?: number;
}

/**
 * Builds the value written when an asset is picked from the library, applying
 * the current crop and copying metadata (flat, incl. alt) plus captured
 * dimensions. Delegates to makeMediaValue, so R10 still holds (a pre-cutover
 * asset with no identity yields a string).
 */
export function buildValueFromAsset(
  asset: SelectableAsset,
  crop: CropMode,
): MediaFieldValue {
  const metadata: Record<string, string | number | undefined> = { ...(asset.metadata ?? {}) };
  if (typeof asset.width === "number") metadata.width = asset.width;
  if (typeof asset.height === "number") metadata.height = asset.height;
  return makeMediaValue({
    assetId: asset.assetId,
    versionId: asset.versionId,
    url: buildValueWithCrop(getBaseUrl(asset.url), crop),
    metaSchemaVersion: asset.metaSchemaVersion,
    metadata,
  });
}

/**
 * Applies a crop mode to a field value. R10: a string stays a string (basic
 * mode) — crop never promotes a value to a partial-identity object.
 */
export function applyCropToValue(
  value: MediaFieldValue,
  crop: CropMode,
): MediaFieldValue {
  const currentUrl = isMediaValue(value) ? value.url : value;
  const baseUrl = getBaseUrl(typeof currentUrl === "string" ? currentUrl : "");
  if (!baseUrl) return value;
  const url = buildValueWithCrop(baseUrl, crop);
  return isMediaValue(value) ? { ...value, url } : url;
}

/**
 * Applies a manual crop region (the interactive cropper's result) to a field
 * value. Same R10 shape as applyCropToValue: a string stays a string, an
 * object keeps its identity and only swaps `url`.
 */
export function applyTrimToValue(
  value: MediaFieldValue,
  rect: TrimRect,
): MediaFieldValue {
  const currentUrl = isMediaValue(value) ? value.url : value;
  const baseUrl = getBaseUrl(typeof currentUrl === "string" ? currentUrl : "");
  if (!baseUrl) return value;
  const url = buildValueWithTrim(baseUrl, rect);
  return isMediaValue(value) ? { ...value, url } : url;
}

/**
 * Sets one metadata field on a value. R10: refuses to operate on a string
 * (returns it unchanged — metadata can't be attached until an asset is picked)
 * and never lets a structural key clobber the pinned identity.
 */
export function setMetaOnValue(
  value: MediaFieldValue,
  fieldName: string,
  fieldValue: string,
): MediaFieldValue {
  if (!isMediaValue(value)) return value;
  if (STRUCTURAL_MEDIA_KEYS.has(fieldName)) return value;
  return { ...value, [fieldName]: fieldValue };
}
