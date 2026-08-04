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
import type { PageMetaFields } from "./seo-metadata";

type PageData = Awaited<ReturnType<typeof getPage>>;

// Untitled pages carry the editor's defaultProps.title boilerplate
// (components/puck/root.tsx); never ship it as <title>/og:title.
const DEFAULT_EDITOR_TITLE = "My Puck Editor";

/**
 * Metadata fields that accept `{{ }}`. ogType and twitterCard are absent by
 * design: their values are checked against a union, so a template could only
 * ever resolve to something the renderer rejects.
 */
const TEMPLATED_META_FIELDS = [
  "ogTitle",
  "ogDescription",
  "ogImage",
  "ogLocale",
  "twitterTitle",
  "twitterImage",
] as const satisfies readonly (keyof PageMetaFields)[];

const carriesTemplate = (value: unknown): value is string =>
  typeof value === "string" && value.includes("{{");

/**
 * Produces the per-page <head> Metadata for a route (PCC-3407). Title,
 * description and the free-text metadata fields are template-allowed.
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
  const authoredMeta = rootProps?._meta as PageMetaFields | undefined;
  const rootTitle = rootProps?.title as string | undefined;
  const rawTitle = rootTitle === DEFAULT_EDITOR_TITLE ? undefined : rootTitle;
  const rawDescription = rootProps?.description as string | undefined;

  const templatedMeta = TEMPLATED_META_FIELDS.filter((field) =>
    carriesTemplate(authoredMeta?.[field]),
  );
  const needsTemplates =
    carriesTemplate(rawTitle) || carriesTemplate(rawDescription) || templatedMeta.length > 0;

  let title = rawTitle;
  let description = rawDescription;
  let meta = authoredMeta;

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

    // One context load, then every templated value resolved against it. Only
    // the fields that carry a template are resolved, so an ordinary page with a
    // templated title does not pay for eight passes.
    const resolveField = async (value: string) => resolveStringTemplates(value, context);

    const [resolvedTitle, resolvedDescription, ...resolvedMeta] = await Promise.all([
      carriesTemplate(rawTitle) ? resolveField(rawTitle) : rawTitle,
      carriesTemplate(rawDescription) ? resolveField(rawDescription) : rawDescription,
      ...templatedMeta.map((field) => resolveField(authoredMeta?.[field] as string)),
    ]);

    title = resolvedTitle;
    description = resolvedDescription;
    meta = {
      ...authoredMeta,
      ...Object.fromEntries(
        templatedMeta.map((field, index) => [field, resolvedMeta[index]]),
      ),
    };
  }

  return buildPageMetadata({
    seo: {
      title,
      description,
      siteName: seo?.siteName,
      meta,
    },
    path,
  });
}
