import type { Metadata } from "next";
import type {
  SeoMetadata,
  getPage,
} from "@pantheon-systems/puck-css/server";
import {
  loadRemoteDatasourceContext,
  extractReferencedDatasourceIds,
  listRouteTemplateKeysFromDatabase,
  resolveStringTemplates,
} from "@pantheon-systems/puck-css/server";
import { REMOTE_DATASOURCE_FETCHERS } from "./remote-datasource-fetchers";
import { buildPageMetadata } from "./seo-metadata";

type PageData = Awaited<ReturnType<typeof getPage>>;

// Untitled pages carry the editor's defaultProps.title boilerplate
// (components/puck/root.tsx); never ship it as <title>/og:title.
const DEFAULT_EDITOR_TITLE = "My Puck Editor";

/**
 * Produces the per-page <head> Metadata for a route (PCC-3407). Title and
 * description are template-allowed properties.
 */
export async function resolvePageMetadata({
  pageData,
  path,
  searchParams,
}: {
  pageData: PageData;
  path: string;
  searchParams: Record<string, string | string[] | undefined>;
}): Promise<Metadata> {
  const rootProps: Record<string, unknown> | undefined = pageData?.root.props;
  const seo: Partial<SeoMetadata> | undefined = rootProps?._seo;
  const rootTitle = rootProps?.title as string | undefined;
  const rawTitle = rootTitle === DEFAULT_EDITOR_TITLE ? undefined : rootTitle;
  const rawDescription = rootProps?.description as string | undefined;

  const needsTemplates =
    (typeof rawTitle === "string" && rawTitle.includes("{{")) ||
    (typeof rawDescription === "string" && rawDescription.includes("{{"));

  let title = rawTitle;
  let description = rawDescription;
  if (needsTemplates && pageData) {
    const routeTemplateKeys = await listRouteTemplateKeysFromDatabase();
    const referencedDatasourceIds = extractReferencedDatasourceIds(pageData);
    const context = await loadRemoteDatasourceContext({
      searchParams,
      fetchImpl: fetch,
      pagePath: path,
      routeTemplateKeys,
      builtinFetchers: REMOTE_DATASOURCE_FETCHERS,
      referencedDatasourceIds,
    });

    const [resolvedTitle, resolvedDescription] = await Promise.all([
      typeof rawTitle === "string"
        ? resolveStringTemplates(rawTitle, context)
        : rawTitle,
      typeof rawDescription === "string"
        ? resolveStringTemplates(rawDescription, context)
        : rawDescription,
    ]);

    title = resolvedTitle;
    description = resolvedDescription;
  }

  return buildPageMetadata({
    seo: {
      title,
      description,
      siteName: seo?.siteName,
    },
    path,
  });
}
