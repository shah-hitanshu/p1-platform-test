"use client";

import { useEffect, useState } from "react";
import type { Data } from "@puckeditor/core";
import { RenderClient, performLogout, P1_LOGGED_IN_KEY } from "@pantheon-systems/puck-css";
import config from "../../puck.config";
import { runWidgetLogout } from "./widget-logout";

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={16} height={16} aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={14} height={14} aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={16} height={16} aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export function P1EditWidget({ route }: { route: string }) {
  const [hasToken, setHasToken] = useState(false);
  const [open, setOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    const flag = typeof localStorage !== "undefined"
      ? localStorage.getItem(P1_LOGGED_IN_KEY)
      : null;
    setHasToken(!!flag);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest("[data-p1-widget]")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!hasToken) return null;

  const editHref = `/p1${route === "/" ? "" : route}`;

  const handleLogout = () =>
    runWidgetLogout({
      logout: () =>
        performLogout({
          cssBaseUrl: process.env.NEXT_PUBLIC_CSS_BASE_URL ?? "http://localhost:8787",
        }),
      navigate: (url) => {
        window.location.href = url;
      },
      reload: () => {
        window.location.reload();
      },
      setBusy: setIsLoggingOut,
      setError: setLogoutError,
    });

  return (
    <div
      data-p1-widget
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 99999,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          height: 38,
          padding: "4px 12px 4px 12px",
          background: "#fff",
          border: "1px solid #e0e0e0",
          borderRadius: 999,
          cursor: "pointer",
          fontSize: 14,
          fontWeight: 500,
          color: "#1a1a1a",
          boxShadow: "0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.06)",
        }}
      >
        <span style={{ fontWeight: 600 }}>P1</span>
        <span
          style={{
            display: "inline-flex",
            color: "#888",
            transition: "transform 200ms ease",
            transform: open ? "rotate(180deg)" : "none",
          }}
        >
          <ChevronIcon />
        </span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            minWidth: 200,
            background: "#fff",
            border: "1px solid #e0e0e0",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            padding: 6,
          }}
        >
          <a
            href={editHref}
            role="menuitem"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              padding: "9px 10px",
              borderRadius: 4,
              fontSize: 14,
              color: "#1a1a1a",
              textDecoration: "none",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f5f5f5"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <span style={{ color: "#888", flex: "0 0 auto" }}><EditIcon /></span>
            Edit this page
          </a>
          <div style={{ height: 1, background: "#e0e0e0", margin: "6px 4px" }} />
          <button
            role="menuitem"
            disabled={isLoggingOut}
            onClick={handleLogout}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              padding: "9px 10px",
              borderRadius: 4,
              fontSize: 14,
              color: "#1a1a1a",
              textDecoration: "none",
              background: "transparent",
              border: "none",
              cursor: isLoggingOut ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#f5f5f5"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <span style={{ color: "#888", flex: "0 0 auto" }}><LogoutIcon /></span>
            {isLoggingOut ? "Logging out…" : "Log out"}
          </button>
          {logoutError && (
            <p
              role="alert"
              style={{
                margin: "2px 10px 6px",
                fontSize: 12,
                lineHeight: 1.4,
                color: "#b3261e",
              }}
            >
              {logoutError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function Client({
  data,
  pageMetadata,
}: {
  data: Data;
  pageMetadata?: {
    route: string;
    documentName?: string;
    pageType?: "page" | "template" | "override";
  };
}) {
  return (
    <>
      <RenderClient config={config} data={data} />
      {pageMetadata && <P1EditWidget route={pageMetadata.route} />}
      {pageMetadata && (
        <footer className="mt-16 border-t border-gray-200 py-4 text-center text-sm text-gray-500">
          Rendered with{" "}
          <span className="font-medium">
            {pageMetadata.documentName || pageMetadata.route}
          </span>{" "}
          from{" "}
          <span className="font-medium">
            {pageMetadata.pageType === "page" && "page"}
            {pageMetadata.pageType === "template" && "page template"}
            {pageMetadata.pageType === "override" && "page template override"}
            {!pageMetadata.pageType && "page"}
          </span>{" "}
          at route{" "}
          <span className="font-mono text-xs">{pageMetadata.route}</span>
        </footer>
      )}
    </>
  );
}
