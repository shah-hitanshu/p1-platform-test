"use client";

import { type ReactNode } from "react";
import { useOptionalP1Auth } from "./P1AuthProvider.js";
import { P1LoginPage } from "./P1LoginPage.js";

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useOptionalP1Auth();

  if (!auth) {
    return <>{children}</>;
  }

  if (auth.isLoading) return null;

  if (!auth.isAuthenticated) {
    return <P1LoginPage />;
  }

  return <>{children}</>;
}
