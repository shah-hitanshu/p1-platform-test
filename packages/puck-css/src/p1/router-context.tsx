"use client";

import { createContext, useContext } from "react";

export interface P1Router {
  refresh(): void;
  replace(url: string, options?: { scroll?: boolean }): void;
  pathname: string;
  searchParams: URLSearchParams;
}

export const P1RouterContext = createContext<P1Router | null>(null);

export function useP1Router(): P1Router {
  const ctx = useContext(P1RouterContext);
  if (!ctx) {
    throw new Error("useP1Router must be used within a P1RouterContext.Provider");
  }
  return ctx;
}
