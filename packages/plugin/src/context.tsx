"use client";

import { createContext, useContext } from "react";

export interface MediaConfig {
  workerUrl: string;
  siteId: string;
  getAuthToken: () => string | null;
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
