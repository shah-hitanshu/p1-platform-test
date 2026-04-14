/**
 * P1 Client page handler — provides page components for `/p1/[...p1]`.
 *
 * Usage:
 *   // app/p1/[...p1]/page.tsx
 *   import { createP1Pages } from "@pantheon-systems/p1-client-sdk/server";
 *   import config from "../../../puck.config";
 *   const pages = createP1Pages({ config });
 *   export default pages.Page;
 *   export const generateMetadata = pages.generateMetadata;
 *   export const dynamic = "force-dynamic";
 */

import "@puckeditor/core/puck.css";
import type { Config, Data } from "@puckeditor/core";
import type { Metadata } from "next";

import { buildRemoteDatasourceRegistry } from "./lib/remote-datasources/remote-datasource-registry";
import {
  loadRemoteDatasourceContext,
  type RemoteDatasourceFetcher,
} from "./lib/remote-datasources/loader";
import { getPage } from "./lib/get-page";
import { getPageEditorPreviewParams } from "./lib/page-editor-meta";
import {
  listRouteTemplateKeysFromDatabase,
  listRoutes,
  type RouteRow,
} from "./lib/page-store";
import {
  pagePathFromCatchAllSegments,
} from "./lib/route-templates";
import { listRemoteDatasourcesForPage } from "./lib/remote-datasources/user-remote-datasource-store";

export type P1PagesConfig = {
  config: Config;
  /** Built-in remote datasource definitions specific to this site (field docs for the editor UI). */
  builtinRemoteDatasources?: Array<{
    id: string;
    label: string;
    description: string;
    resolution: string;
    fields: Array<{ path: string; description: string }>;
  }>;
  /** Built-in fetchers that load remote datasource data at request time. */
  builtinFetchers?: RemoteDatasourceFetcher[];
  /** React component to render the editor. Provided by the consuming app's client wrapper. */
  EditorClient: React.ComponentType<{
    path: string;
    data: Partial<Data>;
    remoteDatasourceContext: Record<string, unknown>;
    routes: RouteRow[];
    routeTemplateKeys: string[];
    savedPreviewParams: Record<string, string>;
    remoteDatasourceRegistry: Array<{
      id: string;
      label: string;
      description: string;
      resolution: string;
      fields: Array<{ path: string; description: string }>;
    }>;
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

  // /p1/edit/... → editor for the path
  if (command === "edit") {
    const rest = path.slice(1);
    return { mode: "editor", pagePath: pagePathFromCatchAllSegments(rest) };
  }

  // /p1/... (anything else) → editor for that path
  return { mode: "editor", pagePath: pagePathFromCatchAllSegments(path) };
}

export function createP1Pages(opts: P1PagesConfig) {
  const { EditorClient, builtinRemoteDatasources = [], builtinFetchers = [] } = opts;

  async function generateMetadata({
    params,
  }: {
    params: Promise<{ p1?: string[] }>;
  }): Promise<Metadata> {
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
    searchParams,
  }: {
    params: Promise<{ p1?: string[] }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }) {
    const { p1 = [] } = await params;
    const { mode, pagePath } = parsePath(p1);

    // Dashboard
    if (mode === "dashboard") {
      const routes = listRoutes();
      return (
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
      );
    }

    // Structure page
    if (mode === "structure") {
      // Import dynamically to avoid bundling structure page in all pages
      const { default: StructurePage } = await import("./pages/structure-page");
      return <StructurePage />;
    }

    // Editor
    if (mode === "editor") {
      const data = getPage(pagePath);
      const sp = await searchParams;
      const routeTemplateKeys = listRouteTemplateKeysFromDatabase();
      const savedPreviewParams = getPageEditorPreviewParams(pagePath);
      const userRemoteDatasources = listRemoteDatasourcesForPage(pagePath);
      const remoteDatasourceRegistry = buildRemoteDatasourceRegistry(
        builtinRemoteDatasources,
        userRemoteDatasources.global,
        userRemoteDatasources.page,
      );
      const context = await loadRemoteDatasourceContext({
        searchParams: sp,
        fetchImpl: fetch,
        pagePath,
        routeTemplateKeys,
        savedPreviewParams,
        builtinFetchers,
      });
      const editorData = data || {};
      const routes = listRoutes();

      return (
        <EditorClient
          path={pagePath}
          data={editorData}
          remoteDatasourceContext={context}
          routes={routes}
          routeTemplateKeys={routeTemplateKeys}
          savedPreviewParams={savedPreviewParams}
          remoteDatasourceRegistry={remoteDatasourceRegistry}
        />
      );
    }

    return <div>Not found</div>;
  }

  return { Page, generateMetadata };
}
