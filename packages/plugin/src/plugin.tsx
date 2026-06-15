"use client";

import { DEFAULT_MEDIA_PATTERNS } from "./patterns";
import { MediaConfigProvider, type MediaConfig } from "./context";
import { MediaFieldRender } from "./components/media-field";

export interface MediaPluginOptions {
  /** The base URL of the Cloudflare Worker media API */
  workerUrl: string;
  /** Site identifier used to scope media to a specific site */
  siteId: string;
  /** Workstream (branch) identifier — scopes media to this workstream, preventing cross-branch leakage */
  workstreamId: string;
  /** Function that returns the current auth token, or null if unauthenticated. May be async (e.g. useP1Auth().getToken). */
  getAuthToken: () => Promise<string | null> | string | null;
  /** Field name patterns that trigger the media picker (defaults to common image URL patterns) */
  fieldNamePatterns?: RegExp[];
}

/**
 * Creates a Puck plugin that automatically replaces text fields matching
 * image/media URL patterns with a media library picker backed by Cloudflare R2.
 *
 * The stored field value is a clean CDN URL with an optional `?smart=true` param
 * set by the content editor. Use `buildImageUrl()` in your components to add
 * size, format, and quality params at render time.
 *
 * @example
 * ```tsx
 * const mediaPlugin = createMediaPlugin({
 *   workerUrl: "https://p1-media-worker-staging.pantheon-content-publisher.workers.dev",
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
    workerUrl: options.workerUrl,
    siteId: options.siteId,
    workstreamId: options.workstreamId,
    getAuthToken: options.getAuthToken,
  };

  return {
    name: "p1-media-r2",
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
      },
    },
  };
}
