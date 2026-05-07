"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { getValidTokens } from "../../data/auth";
import { UserBar } from "./user-bar";

export function AuthGate({ children }: { children: ReactNode }) {
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    getValidTokens().then((tokens) => setIsAuthed(tokens !== null));

    const onAuthChange = () => {
      getValidTokens().then((tokens) => setIsAuthed(tokens !== null));
    };
    window.addEventListener("p1-auth-change", onAuthChange);
    return () => window.removeEventListener("p1-auth-change", onAuthChange);
  }, []);

  if (isAuthed === null) return null;

  return (
    <>
      <UserBar />
      {isAuthed ? (
        children
      ) : (
        <div
          style={{
            padding: "80px 40px",
            textAlign: "center",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
            Sign in required
          </h2>
          <p style={{ color: "#666", fontSize: 14 }}>
            Log in above to access the site editor.
          </p>
        </div>
      )}
    </>
  );
}
