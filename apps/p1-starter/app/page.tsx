import Link from "next/link";
import {
  listRoutes,
  ensureInitialized,
  getPage,
  listRouteTemplateKeysFromDatabase,
  resolveDataTemplates,
  resolveStringTemplates,
  extractReferencedDatasourceIds,
  loadRemoteDatasourceContext,
} from "@pantheon-systems/puck-css/server";
import type { Metadata } from "next";
import { REMOTE_DATASOURCE_FETCHERS } from "../lib/remote-datasource-fetchers";
import { Client } from "./[...puckPath]/client";
import { CollectionNav } from "./collection-nav";

const initPromise = ensureInitialized({
  p1BaseUrl: process.env.NEXT_PUBLIC_CSS_BASE_URL,
  p1ApiKey: process.env.CSS_API_KEY,
  p1SiteId: process.env.NEXT_PUBLIC_CSS_SITE_ID,
  // Default to "main" when unset: server components (no user token) need a
  // branch to list/read documents (e.g. the /structure routes table).
  p1BranchId: process.env.NEXT_PUBLIC_CSS_BRANCH_ID ?? "main",
});

export async function generateMetadata(): Promise<Metadata> {
  await initPromise;
  const pageData = await getPage("/");
  if (!pageData) {
    return { title: "P1 Starter Kit" };
  }

  const rawTitle = pageData.root.props?.title;
  if (typeof rawTitle !== "string") {
    return { title: rawTitle };
  }
  if (!rawTitle.includes("{{")) {
    return { title: rawTitle };
  }
  const routeTemplateKeys = await listRouteTemplateKeysFromDatabase();
  const referencedDatasourceIds = extractReferencedDatasourceIds(pageData);
  const context = await loadRemoteDatasourceContext({
    searchParams: {},
    fetchImpl: fetch,
    pagePath: "/",
    routeTemplateKeys,
    builtinFetchers: REMOTE_DATASOURCE_FETCHERS,
    referencedDatasourceIds,
  });
  return { title: await resolveStringTemplates(rawTitle, context) };
}

export default async function HomePage() {
  await initPromise;
  const data = await getPage("/");

  if (data) {
    const routeTemplateKeys = await listRouteTemplateKeysFromDatabase();
    const referencedDatasourceIds = extractReferencedDatasourceIds(data);
    const context = await loadRemoteDatasourceContext({
      searchParams: {},
      fetchImpl: fetch,
      pagePath: "/",
      routeTemplateKeys,
      builtinFetchers: REMOTE_DATASOURCE_FETCHERS,
      referencedDatasourceIds,
    });
    const resolvedData = await resolveDataTemplates(data, context);
    return (
      <Client
        data={resolvedData}
        pageMetadata={{
          route: "/",
          documentName: data.root.props?.title as string | undefined,
          pageType: "page",
        }}
      />
    );
  }

  const routes = await listRoutes();

  const staticPages = routes.filter((r) => r.kind === "static");
  const templates = routes.filter((r) => r.kind === "template");

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          Welcome to the P1 Starter Kit
        </h1>
        <p className="mt-4 text-gray-600">
          Build and manage pages with the visual editor, or head to the
          dashboard to manage your site.
        </p>

        <nav className="mt-10 flex flex-col gap-3">
          <Link
            href="/p1"
            className="rounded-lg bg-gray-900 px-5 py-3 text-sm font-medium text-white hover:bg-gray-700"
          >
            Open the Page Editor
          </Link>
          <a
            href="https://staging.content.pantheon.io/dashboard/sites"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-gray-300 px-5 py-3 text-sm font-medium text-gray-900 hover:bg-gray-100"
          >
            P1 Dashboard &rarr;
          </a>
        </nav>

        {(staticPages.length > 0 || templates.length > 0) && (
          <div className="mt-10 text-left">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Pages</h2>
            <ul className="space-y-3">
              {staticPages.map((route) => (
                <li key={route.path}>
                  <Link
                    href={route.path}
                    className="text-sm font-mono text-blue-600 hover:underline"
                  >
                    {route.path}
                  </Link>
                </li>
              ))}
              {templates.map((route) => (
                <li key={route.path}>
                  <CollectionNav templatePath={route.path} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}

export const dynamic = "force-dynamic";
