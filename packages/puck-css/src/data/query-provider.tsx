"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";

const QUERY_DEFAULTS = {
  queries: {
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  },
};

export function P1QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: QUERY_DEFAULTS }));

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * The QueryClient that SDK internals fetch through, kept out of react-query's
 * own context on purpose: a host application's client would govern SDK requests
 * through its retry and staleTime defaults, share a key namespace with them, and
 * drop their state on any clear() or broad invalidation of its own. Callers pass
 * this client to useQuery and useMutation explicitly, so a host component
 * rendered inside the editor still resolves the host's client from context.
 */
export const P1SdkQueryClientContext = createContext<QueryClient | null>(null);

export function P1SdkQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: QUERY_DEFAULTS }));

  return (
    <P1SdkQueryClientContext.Provider value={client}>{children}</P1SdkQueryClientContext.Provider>
  );
}

export function useP1SdkQueryClient(): QueryClient {
  const client = useContext(P1SdkQueryClientContext);

  if (client === null) {
    throw new Error("useP1SdkQueryClient must be used within a P1SdkQueryProvider");
  }

  return client;
}
