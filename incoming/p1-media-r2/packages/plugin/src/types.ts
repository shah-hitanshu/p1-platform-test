// Shared value + schema types for the p1-media field. No runtime, RSC-safe.

/**
 * A metadata field advertised by the Worker's `GET /media/schema` endpoint.
 * The set is Pantheon-defined and global for v1; the plugin renders one input
 * per entry and iterates these to render metadata generically (req. R14).
 */
export interface MetadataFieldDef {
  name: string;
  label: string;
  type: "string";
  required?: boolean;
}

/**
 * The value written by the `p1-media` field (rich mode). Carries the pinned
 * asset identity plus a snapshot of the metadata defaults copied at edit time.
 * `metaSchemaVersion` records the schema that produced the snapshot (req. R12).
 * `alt` and any schema-driven fields (byline, caption, …) live alongside as
 * string metadata; `width`/`height` may be present as captured numeric
 * dimensions (a CLS win when rendered).
 */
export interface MediaValue {
  assetId: string;
  versionId: string;
  url: string;
  metaSchemaVersion?: number;
  alt?: string;
  [meta: string]: string | number | undefined;
}

/**
 * string = basic mode (a bare CDN URL, kept first-class forever); object =
 * rich mode. Every render helper accepts both.
 */
export type MediaFieldValue = string | MediaValue;

/** Props produced by getMediaProps, spreadable onto `<img>` or next/image. */
export interface MediaProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}
