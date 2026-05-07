/**
 * P1 Next SDK page handler — provides page components for `/p1/[...p1]`.
 *
 * Usage:
 *   // app/p1/[...p1]/page.tsx
 *   import { createP1Pages } from "@pantheon-systems/p1-next-sdk";
 *   import config from "../../../puck.config";
 *   const pages = createP1Pages({ config });
 *   export default pages.Page;
 *   export const generateMetadata = pages.generateMetadata;
 *   export const dynamic = "force-dynamic";
 */

import "@puckeditor/core/puck.css";
import type { Config, Data } from "@puckeditor/core";
import type { Metadata } from "next";

import {
  listRoutes,
  type RouteRow,
  pagePathFromCatchAllSegments,
  ensureInitialized,
  type P1DataConfig,
} from "@pantheon-systems/puck-css/server";
import { AuthGate } from "@pantheon-systems/puck-css/auth-gate";
import { P1NextRouterProvider } from "./P1NextRouterProvider.js";

export type P1PagesConfig = P1DataConfig & {
  config: Config;
  /** React component to render the editor. Receives only the page path; handles its own data loading and auth via CSSApp. */
  EditorClient: React.ComponentType<{
    path: string;
  }>;
  /** React component to render published pages. Provided by the consuming app's client wrapper. */
  RenderClient: React.ComponentType<{
    data: Data;
  }>;
};

function parsePath(path: string[]): { mode: string; pagePath: string } {
  if (path.length === 0) return { mode: "dashboard", pagePath: "/" };
  const command = path[0];

  // /p1/api/... is handled by the route handler, not the page
  if (command === "api") return { mode: "api", pagePath: "/" };

  // /p1/structure
  if (command === "structure") return { mode: "structure", pagePath: "/" };

  // /p1/edit/... -> editor for the path
  if (command === "edit") {
    const rest = path.slice(1);
    return { mode: "editor", pagePath: pagePathFromCatchAllSegments(rest) };
  }

  // /p1/... (anything else) -> editor for that path
  return { mode: "editor", pagePath: pagePathFromCatchAllSegments(path) };
}

export function createP1Pages(opts: P1PagesConfig) {
  const { EditorClient } = opts;
  const initPromise = ensureInitialized(opts);

  async function generateMetadata({
    params,
  }: {
    params: Promise<{ p1?: string[] }>;
  }): Promise<Metadata> {
    await initPromise;
    const { p1 = [] } = await params;
    const { mode, pagePath } = parsePath(p1);

    if (mode === "dashboard") {
      return { title: "P1 Dashboard" };
    }
    if (mode === "structure") {
      return { title: "Site Structure" };
    }
    return { title: "P1 Editor: " + pagePath };
  }

  async function Page({
    params,
  }: {
    params: Promise<{ p1?: string[] }>;
  }) {
    await initPromise;
    const { p1 = [] } = await params;
    const { mode, pagePath } = parsePath(p1);

    // Dashboard
    if (mode === "dashboard") {
      let routes: RouteRow[] = [];
      try {
        routes = await listRoutes();
      } catch {
        // Backend timeout or API error — show empty state
      }
      return (
        <AuthGate>
          <div
            style={{
              fontFamily: "system-ui, sans-serif",
              padding: "24px 32px",
              maxWidth: 960,
            }}
          >
            <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 16px" }}>
              P1 Dashboard
            </h1>
            <p style={{ color: "#555", marginBottom: 24 }}>
              Manage your site pages and templates.
            </p>
            <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
              <a
                href="/p1/structure"
                style={{
                  padding: "8px 16px",
                  background: "#2563eb",
                  color: "#fff",
                  borderRadius: 6,
                  textDecoration: "none",
                  fontSize: 14,
                }}
              >
                Site Structure
              </a>
            </div>
            {routes.length > 0 ? (
              <ul style={{ listStyle: "none", padding: 0 }}>
                {routes.map((r) => (
                  <li key={r.path} style={{ marginBottom: 8 }}>
                    <a
                      href={`/p1${r.path === "/" ? "" : r.path}`}
                      style={{
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 14,
                      }}
                    >
                      {r.path}
                    </a>
                    <span style={{ color: "#888", fontSize: 13, marginLeft: 8 }}>
                      {r.kind}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ color: "#666" }}>
                No pages yet. Use Site Structure to create one.
              </p>
            )}
          </div>
        </AuthGate>
      );
    }

    // Structure page
    if (mode === "structure") {
      const { StructurePage } = await import("@pantheon-systems/puck-css/server");
      return (
        <AuthGate>
          <P1NextRouterProvider>
            <StructurePage />
          </P1NextRouterProvider>
        </AuthGate>
      );
    }

    // Editor — CSSApp handles auth and data loading client-side
    if (mode === "editor") {
      return <EditorClient path={pagePath} />;
    }

    return <div>Not found</div>;
  }

  return { Page, generateMetadata };
}
