/**
 * Route builders for the published-page render pipeline.
 *
 * The pipeline itself — read the page, branch on the outcome, resolve route
 * templates and remote datasources, render — is the same for every P1 site, and
 * carries the invariants documented in published-page.ts. Hand-assembling it in
 * each app's route files froze a copy of it into every scaffold, so improvements
 * to caching or datasource resolution could never reach a project once it was
 * created. It lives here instead, and the routes become shims.
 *
 * What genuinely differs per app flows in as options: the render client (which
 * holds that app's puck.config), the components shown when content is
 * unavailable or the home page has no document yet, the app's datasource
 * fetcher registry, and how it turns page data into <head> metadata.
 *
 * Usage:
 *   // app/published-pages.tsx (shared module — one instance, both routes)
 *   import { createPublishedPage } from "@pantheon-systems/p1-next-sdk/server";
 *   export const published = createPublishedPage({ ... });
 *
 *   // app/[...puckPath]/page.tsx
 *   export const revalidate = 300;
 *   export default published.Page;
 *   export const generateMetadata = published.generateMetadata;
 *   export const generateStaticParams = published.generateStaticParams;
 *
 *   // app/page.tsx
 *   export const revalidate = 300;
 *   export default published.HomePage;
 *   export const generateMetadata = published.generateHomeMetadata;
 *
 * `revalidate` must stay a literal in the route file. Next.js statically
 * analyzes segment-config exports, so re-exporting one through the factory
 * leaves it undetected and the route silently loses its revalidation window —
 * the same constraint that keeps `dynamic` in the route file for createP1Pages.
 */

import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  loadRemoteDatasourceContext,
  extractReferencedDatasourceIds,
  resolveDataTemplates,
  pagePathFromCatchAllSegments,
  type RemoteDatasourceFetcher,
} from "@pantheon-systems/puck-css/server";
import type { Data } from "@puckeditor/core";

import { createCssQueryFetchers } from "./css-query-fetchers";
import {
  loadPublishedPage,
  loadRouteTemplateKeys,
  type PublishedPageResult,
} from "./published-page";
import { resolvePageMetadata } from "./resolve-page-metadata";

/**
 * Describes the rendered document to the render client, which uses it for the
 * edit affordances that only make sense once a real document is on screen.
 */
export type PublishedPageMetadata = {
  route: string;
  documentName?: string;
  pageType?: "page" | "template" | "override";
};

export type PublishedPageClientProps = {
  data: Data;
  pageMetadata: PublishedPageMetadata;
};

export type CreatePublishedPageConfig = {
  /**
   * Renders resolved Puck data. Holds the app's puck.config, which is why this
   * cannot live in the SDK.
   */
  Client: React.ComponentType<PublishedPageClientProps>;
  /**
   * Rendered instead of a 404 when the backend could not be reached. A
   * published page must not 404 over a blip — that deindexes live content — so
   * this is a 200 holding page on a render the SDK has already made uncacheable.
   */
  Unavailable: React.ComponentType;
  /**
   * Rendered at "/" when no home document exists. Unlike the catch-all, "/"
   * never 404s: it is a single fixed URL rather than an unbounded crawler
   * surface, and a welcome state is the right answer for a freshly scaffolded
   * site — including one with no backend configured yet.
   */
  Fallback: React.ComponentType;
  /** The app's remote-datasource fetcher registry. */
  fetchers?: RemoteDatasourceFetcher[];
  /**
   * Turns published page data into <head> metadata. Called only for a page that
   * actually resolved; the miss and outage titles come from `titles`.
   *
   * Defaults to the SDK's own resolver, which maps the stored root props
   * (`_seo`, `_meta`) onto the head tags using `fetchers` for `{{ }}`
   * resolution. Pass one to replace that mapping — to add tags on top of it,
   * call `resolvePageMetadata` with its `transform` option.
   */
  resolveMetadata?: (args: {
    pageData: Data;
    path: string;
  }) => Metadata | Promise<Metadata>;
  titles?: {
    /** Catch-all, no such page. Default "Not Found". */
    notFound?: string;
    /** Backend unreachable. Default "Temporarily unavailable". */
    unavailable?: string;
    /** "/" with no home document yet — pairs with `Fallback`. Default "Home". */
    home?: string;
  };
  /** Extra internal path prefixes to refuse, on top of the SDK's own list. */
  internalPathPrefixes?: readonly string[];
};

export function createPublishedPage(config: CreatePublishedPageConfig) {
  const {
    Client,
    Unavailable,
    Fallback,
    fetchers = [],
    resolveMetadata = ({ pageData, path }) =>
      resolvePageMetadata({ pageData, path, fetchers }),
    titles,
    internalPathPrefixes,
  } = config;

  const loadOptions = internalPathPrefixes ? { internalPathPrefixes } : undefined;

  // Memoized per request: building the CCR query fetchers reads the datasource
  // registry, and metadata resolution and the page body each need them.
  const getCssQueryFetchers = cache(() => createCssQueryFetchers());

  async function resolve(
    path: string,
    data: Data,
  ): Promise<Data> {
    const [routeTemplateKeys, cssQueryFetchers] = await Promise.all([
      loadRouteTemplateKeys(),
      getCssQueryFetchers(),
    ]);
    const context = await loadRemoteDatasourceContext({
      fetchImpl: fetch,
      pagePath: path,
      routeTemplateKeys,
      builtinFetchers: [...fetchers, ...cssQueryFetchers],
      referencedDatasourceIds: extractReferencedDatasourceIds(data),
    });
    return resolveDataTemplates(data, context);
  }

  async function render(path: string, data: Data) {
    const resolvedData = await resolve(path, data);
    return (
      <Client
        data={resolvedData}
        pageMetadata={{
          route: path,
          documentName: data.root.props?.title as string | undefined,
          pageType: "page",
        }}
      />
    );
  }

  async function metadataFor(
    result: PublishedPageResult,
    path: string,
  ): Promise<Metadata> {
    if (result.status === "missing") {
      return { title: titles?.notFound ?? "Not Found" };
    }
    if (result.status === "unavailable") {
      return { title: titles?.unavailable ?? "Temporarily unavailable" };
    }
    return resolveMetadata({ pageData: result.data, path });
  }

  /**
   * Empty on purpose. Routes are authored in P1, so there is nothing to
   * enumerate at build time — but declaring this is what marks the segment
   * statically renderable at all; without it every path renders fully
   * dynamically and no response is ever cacheable. Unlisted paths render on
   * first request and are cached from then on (dynamicParams defaults to true).
   */
  function generateStaticParams(): { puckPath: string[] }[] {
    return [];
  }

  async function generateMetadata({
    params,
  }: {
    params: Promise<{ puckPath: string[] }>;
  }): Promise<Metadata> {
    const { puckPath = [] } = await params;
    const path = pagePathFromCatchAllSegments(puckPath);
    return metadataFor(await loadPublishedPage(path, loadOptions), path);
  }

  async function Page({
    params,
  }: {
    params: Promise<{ puckPath: string[] }>;
  }) {
    const { puckPath = [] } = await params;
    const path = pagePathFromCatchAllSegments(puckPath);
    const result = await loadPublishedPage(path, loadOptions);

    // A real 404, so misses are not cached as successes now that this route is
    // statically renderable. An outage is deliberately not a 404 — that would
    // deindex published pages over a transient blip.
    if (result.status === "missing") {
      notFound();
    }
    if (result.status === "unavailable") {
      return <Unavailable />;
    }
    return render(path, result.data);
  }

  async function generateHomeMetadata(): Promise<Metadata> {
    const result = await loadPublishedPage("/", loadOptions);
    if (result.status !== "ok") {
      return { title: titles?.home ?? "Home" };
    }
    return metadataFor(result, "/");
  }

  async function HomePage() {
    const result = await loadPublishedPage("/", loadOptions);
    if (result.status !== "ok") {
      return <Fallback />;
    }
    return render("/", result.data);
  }

  return {
    Page,
    HomePage,
    generateMetadata,
    generateHomeMetadata,
    generateStaticParams,
  };
}
