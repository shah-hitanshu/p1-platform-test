import { WelcomeBlockRender } from "../components/puck/welcome-block-render";
import {
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

  return (
    <WelcomeBlockRender
      heading="Welcome to your new Pantheon P1 Site."
      description="You just created this new site from Pantheon P1 starter kit, congrats! You'll need a Pantheon P1 user account to edit it and create new pages."
      ctaLabel="Sign-in to P1"
      ctaHref="/p1"
      footnote="Visit [P1 documentation](https://docs.pantheon.io) for more information."
      loggedInHeading="Welcome to your new Pantheon P1 Site."
      loggedInDescription="You just created this new site from Pantheon P1 starter kit, congrats! Start editing this page or visit the P1 dashboard to manage your site."
      loggedInCtaLabel="Edit this page with P1 Visual Editor"
      loggedInCtaHref="/p1"
      loggedInSecondaryLabel="Go to P1 Dashboard"
      loggedInFootnote="Visit [P1 documentation](https://docs.pantheon.io) for more information."
      showLogo={true}
    />
  );
}

export const dynamic = "force-dynamic";
