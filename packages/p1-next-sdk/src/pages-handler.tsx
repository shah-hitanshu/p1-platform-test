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

import type { Config } from "@puckeditor/core";
import type { Metadata } from "next";

import {
  pagePathFromCatchAllSegments,
  ensureInitialized,
  type P1DataConfig,
} from "@pantheon-systems/puck-css/server";

export type P1PagesConfig = P1DataConfig & {
  config: Config;
  /** React component to render the editor. Receives only the page path; handles its own data loading and auth via P1App. */
  EditorClient: React.ComponentType<{
    path: string;
  }>;
};

function parsePath(path: string[]): { pagePath: string } {
  if (path.length === 0) return { pagePath: "/" };
  const command = path[0];

  // /p1/api/... is handled by the route handler, not the page
  if (command === "api") return { pagePath: "/" };

  // /p1/edit/... -> editor for the path
  if (command === "edit") {
    const rest = path.slice(1);
    return { pagePath: pagePathFromCatchAllSegments(rest) };
  }

  // /p1/... (anything else) -> editor for that path
  return { pagePath: pagePathFromCatchAllSegments(path) };
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
    const { pagePath } = parsePath(p1);
    return { title: "P1 Editor: " + pagePath };
  }

  async function Page({
    params,
  }: {
    params: Promise<{ p1?: string[] }>;
  }) {
    await initPromise;
    const { p1 = [] } = await params;
    const { pagePath } = parsePath(p1);

    return <EditorClient path={pagePath} />;
  }

  return { Page, generateMetadata };
}
