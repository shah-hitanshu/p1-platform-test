import {
  resolveDataTemplates,
  extractReferencedDatasourceIds,
  loadRemoteDatasourceContext,
} from "@pantheon-systems/puck-css/server";
import {
  loadPublishedPage,
  loadRouteTemplateKeys,
} from "@pantheon-systems/p1-next-sdk/server";
import type { Metadata } from "next";
import { WelcomeBlockRender } from "../components/puck/welcome-block-render";
import { resolvePageMetadata } from "../lib/page-seo";
import { REMOTE_DATASOURCE_FETCHERS } from "../lib/remote-datasource-fetchers";
import { Client } from "./[...puckPath]/client";

/**
 * Backstop only: publishing calls revalidatePath("/"), so the home page
 * normally refreshes the moment its content changes. This bounds how long an
 * edit made outside that path can stay stale.
 */
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const result = await loadPublishedPage("/");
  if (result.status !== "ok") {
    return { title: "P1 Starter Kit" };
  }
  return resolvePageMetadata({ pageData: result.data, path: "/" });
}

export default async function HomePage() {
  const result = await loadPublishedPage("/");

  // Unlike the catch-all, "/" never 404s: it is a single fixed URL rather than
  // an unbounded crawler surface, and the welcome block is the correct state for
  // a freshly scaffolded site — including one with no backend configured yet.
  if (result.status === "ok") {
    const data = result.data;
    const routeTemplateKeys = await loadRouteTemplateKeys();
    const referencedDatasourceIds = extractReferencedDatasourceIds(data);
    const context = await loadRemoteDatasourceContext({
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
