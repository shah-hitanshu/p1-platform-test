"use client";

import type { ReactNode } from "react";
import { createNextConfig, P1AuthProvider, useP1Auth } from "@pantheon-systems/puck-css";
import { AuthGate } from "@pantheon-systems/puck-css/auth-gate";

let p1Config: ReturnType<typeof createNextConfig> | null = null;
let p1ConfigError: string | null = null;
try {
  p1Config = createNextConfig();
} catch (e) {
  p1ConfigError = e instanceof Error ? e.message : String(e);
}

function UserBar() {
  const { user, logout } = useP1Auth();

  if (!user) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 12,
        padding: "6px 16px",
        background: "#1b1b1b",
        color: "#e0e0e0",
        fontSize: 13,
        fontFamily: "system-ui, sans-serif",
        borderBottom: "1px solid #333",
      }}
    >
      {user.picture ? (
        <img
          src={user.picture}
          alt=""
          referrerPolicy="no-referrer"
          style={{ width: 24, height: 24, borderRadius: "50%" }}
        />
      ) : (
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: "#555",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            color: "#fff",
          }}
        >
          {(user.name || user.email || "?").charAt(0).toUpperCase()}
        </div>
      )}
      <span style={{ opacity: 0.9 }}>
        {user.name || user.email || "User"}
      </span>
      <button
        onClick={logout}
        style={{
          background: "transparent",
          color: "#888",
          border: "1px solid #555",
          borderRadius: 4,
          padding: "2px 10px",
          fontSize: 12,
          cursor: "pointer",
          marginLeft: 4,
        }}
      >
        Log out
      </button>
    </div>
  );
}

function ConfigError({ message }: { message: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: "#f5f5f5",
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 12,
          boxShadow: "0 4px 24px rgba(0,0,0,0.1)",
          padding: 40,
          maxWidth: 480,
          width: "100%",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 16 }}>&#9888;</div>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 12px", color: "#1a1a1a" }}>
          Configuration Required
        </h1>
        <p style={{ fontSize: 14, color: "#666", marginBottom: 24, lineHeight: 1.6 }}>
          The editor cannot start because required environment variables are missing.
        </p>
        <div
          style={{
            background: "#fff0f0",
            border: "1px solid #fecaca",
            borderRadius: 8,
            padding: "12px 16px",
            fontSize: 13,
            color: "#991b1b",
            fontFamily: "ui-monospace, monospace",
            textAlign: "left",
            marginBottom: 24,
          }}
        >
          {message}
        </div>
        <p style={{ fontSize: 13, color: "#888", lineHeight: 1.5 }}>
          Set <code style={{ background: "#f0f0f0", padding: "2px 6px", borderRadius: 4 }}>NEXT_PUBLIC_CSS_BASE_URL</code> and{" "}
          <code style={{ background: "#f0f0f0", padding: "2px 6px", borderRadius: 4 }}>NEXT_PUBLIC_CSS_SITE_ID</code> in your{" "}
          <code style={{ background: "#f0f0f0", padding: "2px 6px", borderRadius: 4 }}>.env</code> file.
        </p>
      </div>
    </div>
  );
}

export function P1AuthShell({ children }: { children: ReactNode }) {
  if (!p1Config) {
    return <ConfigError message={p1ConfigError ?? "CSS configuration is missing."} />;
  }

  return (
    <P1AuthProvider
      authMode={p1Config.authMode}
      p1BaseUrl={p1Config.baseUrl}
    >
      <AuthGate>
        <UserBar />
        {children}
      </AuthGate>
    </P1AuthProvider>
  );
}
