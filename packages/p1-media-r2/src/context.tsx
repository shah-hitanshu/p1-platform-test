"use client";

import { createContext, useContext } from "react";
import type { MetadataFieldDef } from "./types";

export interface MediaConfig {
  workerUrl: string;
  siteId: string;
  workstreamId: string;
  getAuthToken: () => Promise<string | null> | string | null;
  /**
   * Fallback metadata field schema for the rich `p1-media` field, used when
   * `GET /media/schema` is absent/unreachable (lets the plugin ship before the
   * Worker upgrade). Defaults to `[{ name: "alt", label: "Alt text", type: "string" }]`.
   */
  metadataFields?: MetadataFieldDef[];
}

const MediaConfigContext = createContext<MediaConfig | null>(null);

export function MediaConfigProvider({
  config,
  children,
}: {
  config: MediaConfig;
  children: React.ReactNode;
}) {
  return (
    <MediaConfigContext.Provider value={config}>
      {children}
    </MediaConfigContext.Provider>
  );
}

export function useMediaConfig(): MediaConfig {
  const ctx = useContext(MediaConfigContext);
  if (!ctx)
    throw new Error("useMediaConfig must be used within MediaConfigProvider");
  return ctx;
}
