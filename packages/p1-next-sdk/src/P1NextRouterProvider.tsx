"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { P1RouterContext, type P1Router } from "@pantheon-systems/puck-css";

export function P1NextRouterProvider({ children }: { children: ReactNode }) {
  const nextRouter = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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
