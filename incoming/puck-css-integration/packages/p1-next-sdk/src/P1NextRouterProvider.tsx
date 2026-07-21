"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useMemo, useEffect, useRef, type ReactNode } from "react";
import { P1RouterContext, type P1Router } from "@pantheon-systems/puck-css";

export function P1NextRouterProvider({ children }: { children: ReactNode }) {
  const nextRouter = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isInitialMount = useRef(true);

  // Re-fetch server component data on back/forward navigation.
  // Without this, Next.js restores the cached client shell but the
  // server-rendered content inside it is empty.
  useEffect(() => {
    const handler = (event: PageTransitionEvent) => {
      if (event.persisted) {
        nextRouter.refresh();
      }
    };
    window.addEventListener("pageshow", handler);
    return () => window.removeEventListener("pageshow", handler);
  }, [nextRouter]);

  // Also handle popstate (Next.js client-side back navigation)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    nextRouter.refresh();
  }, [pathname, nextRouter]);

  const router: P1Router = useMemo(
    () => ({
      refresh: () => nextRouter.refresh(),
      replace: (url: string, options?: { scroll?: boolean }) =>
        nextRouter.replace(url, options),
      pathname,
      searchParams,
    }),
    [nextRouter, pathname, searchParams],
  );

  return (
    <P1RouterContext.Provider value={router}>
      {children}
    </P1RouterContext.Provider>
  );
}
