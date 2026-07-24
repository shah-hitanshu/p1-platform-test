"use client";

import { DEFAULT_MEDIA_PATTERNS } from "./patterns";
import { MediaConfigProvider, type MediaConfig } from "./context";
import { MediaFieldRender } from "./components/media-field";
import { MediaObjectFieldRender } from "./components/media-object-field";
import type { MediaFieldValue, MetadataFieldDef } from "./types";

/** Production Worker/CDN host — same origin serves both the `/media` API and `/image` delivery. */
const DEFAULT_WORKER_URL = "https://media.p1.pantheon.io";

export interface MediaPluginOptions {
  /** The base URL of the Cloudflare Worker media API. Defaults to the production host. */
  workerUrl?: string;
  /** Site identifier used to scope media to a specific site */
  siteId: string;
  /**
   * Workstream (branch) identifier. Currently accepted for forward-compat but not
   * read by the Worker for any scoping decision — omit unless a future release
   * documents otherwise.
   */
  workstreamId?: string;
  /** Function that returns the current auth token, or null if unauthenticated. May be async (e.g. useP1Auth().getToken). */
  getAuthToken: () => Promise<string | null> | string | null;
  /** Field name patterns that trigger the media picker (defaults to common image URL patterns) */
  fieldNamePatterns?: RegExp[];
  /**
   * Fallback metadata field schema for the rich `p1-media` field, used when
   * `GET /media/schema` is unavailable. Defaults to
   * `[{ name: "alt", label: "Alt text", type: "string" }]`.
   */
  metadataFields?: MetadataFieldDef[];
}

/**
 * Creates a Puck plugin that adds a media library backed by Cloudflare R2 + D1.
 * It supports two field modes:
 *   - Basic: text fields matching image/media name patterns are replaced with the
 *     picker and store a clean CDN URL string. Render with `buildImageUrl()`.
 *   - Rich: a registered `p1-media` field type stores a MediaValue object (version
 *     URL + metadata such as alt). Render with `getMediaProps()` / `MediaImage` /
 *     `MediaFigure`. The editor's crop intent is carried as `?fit=…&gravity=…`.
 *
 * @example
 * ```tsx
 * const mediaPlugin = createMediaPlugin({
 *   siteId: "my-site",
 *   getAuthToken: () => localStorage.getItem("token"),
 * });
 *
 * <Puck plugins={[mediaPlugin]} config={config} data={data} />
 * ```
 */
export function createMediaPlugin(options: MediaPluginOptions) {
  const patterns = options.fieldNamePatterns ?? DEFAULT_MEDIA_PATTERNS;
  const config: MediaConfig = {
    workerUrl: options.workerUrl ?? DEFAULT_WORKER_URL,
    siteId: options.siteId,
    workstreamId: options.workstreamId,
    getAuthToken: options.getAuthToken,
    metadataFields: options.metadataFields,
  };

  return {
    name: "p1-media",
    overrides: {
      fieldTypes: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        text: (props: any) => {
          const { children, name, field, value, onChange, readOnly, id } = props;
          // Puck passes qualified names for array items (e.g. "slides[0].imageUrl").
          // Extract the last segment so patterns match the bare field name.
          const bareFieldName = name?.split(".").pop() ?? name;
          const isMediaField = patterns.some((p: RegExp) => p.test(bareFieldName));

          if (!isMediaField) {
            return <>{children}</>;
          }

          return (
            <MediaConfigProvider config={config}>
              <MediaFieldRender
                field={{
                  type: "custom" as const,
                  label: field?.label ?? name,
                  render: () => <></>,
                }}
                name={name}
                id={id ?? name}
                value={value ?? ""}
                onChange={onChange}
                readOnly={readOnly}
              />
            </MediaConfigProvider>
          );
        },
        // Rich mode: a first-class `p1-media` field whose value is an object.
        // Puck ≥0.20 dispatches overrides.fieldTypes[field.type] for new types.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "p1-media": (props: any) => {
          const { name, field, value, onChange, readOnly, id } = props;
          return (
            <MediaConfigProvider config={config}>
              <MediaObjectFieldRender
                label={field?.label ?? name}
                name={name}
                id={id ?? name}
                value={value ?? ""}
                onChange={onChange}
                readOnly={readOnly}
              />
            </MediaConfigProvider>
          );
        },
      },
    },
    // Editor-preview only (never written back): normalize a legacy string to
    // the object shape so components reading the raw prop see `{ url, alt }`.
    // The R10 write-path guard lives in makeMediaValue, not here.
    fieldTransforms: {
      "p1-media": ({ value }: { value: MediaFieldValue }) =>
        typeof value === "string" ? { url: value, alt: "" } : value,
    },
  };
}
