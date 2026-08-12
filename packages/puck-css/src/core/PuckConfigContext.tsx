"use client";

import { createContext, useContext } from "react";
import type { Config } from "@puckeditor/core";

const PuckConfigContext = createContext<Config | null>(null);

export function PuckConfigProvider({
  config,
  children,
}: {
  config: Config;
  children: React.ReactNode;
}) {
  return (
    <PuckConfigContext.Provider value={config}>
      {children}
    </PuckConfigContext.Provider>
  );
}

export function usePuckConfig(): Config | null {
  return useContext(PuckConfigContext);
}
