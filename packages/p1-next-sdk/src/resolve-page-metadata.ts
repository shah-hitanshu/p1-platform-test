/**
 * Turns a published page's stored root props into the route's `<head>`
 * Metadata.
 *
 * The mapping is the same for every P1 site — it is coupled to the shapes the
 * editor stores (`root.props._seo`, `root.props._meta`), not to anything about
 * a particular site's branding. Assembling it in each app froze a copy into
 * every scaffold, so a change to the stored shape would silently mishandle it
 * everywhere. It lives here instead, and what genuinely differs per app flows
 * in as options: the datasource fetchers that back `{{ }}` templates, and a
 * `transform` for the tags a site wants to add or override.
 */

import type { Metadata } from "next";
import {
  loadRemoteDatasourceContext,
  extractReferencedDatasourceIds,
  resolveStringTemplates,
  type RemoteDatasourceFetcher,
  type SeoMetadata,
} from "@pantheon-systems/puck-css/server";
import { DEFAULT_EDITOR_ROOT_TITLE } from "@pantheon-systems/puck-css/seo";
import type { Data } from "@puckeditor/core";

import { loadRouteTemplateKeys } from "./published-page";
import { buildPageMetadata, type PageMetaFields } from "./page-metadata";

/**
 * The two fields `{{ }}` is refused on. Their values are checked against a
 * union, so a template could only ever resolve to something the renderer
 * rejects. Every other `_meta` field is free text and templates — including
 * fields a site has added to the stored shape.
 */
const FIXED_VOCABULARY_FIELDS: readonly string[] = ["ogType", "twitterCard"];

const carriesTemplate = (value: unknown): value is string =>
  typeof value === "string" && value.includes("{{");

/**
 * Authored `_meta` as stored. The index signature is what lets a site add its
 * own fields to the group: they template like the rest, and reach `<head>`
 * through `transform`.
 */
export type AuthoredPageMeta = PageMetaFields & Record<string, unknown>;

/**
 * What produced the Metadata handed to `transform` — the page it came from, and
 * the authored values with any `{{ }}` already resolved. Reading the resolved
 * values here is what lets a site emit a tag from a field it added, rather than
 * re-resolving the templates itself.
 */
export type PageMetadataContext = {
  pageData: Data | null | undefined;
  path: string;
  title?: string;
  description?: string;
  meta: AuthoredPageMeta;
};

export type ResolvePageMetadataOptions = {
  pageData: Data | null | undefined;
  path: string;
  /** The app's remote-datasource fetcher registry, for `{{ }}` resolution. */
  fetchers?: RemoteDatasourceFetcher[];
  /**
   * Last word on the emitted Metadata, for the tags a site wants to add or
   * override. Runs after the stored values have been mapped and any templates
   * resolved.
   */
  transform?: (
    metadata: Metadata,
    context: PageMetadataContext,
  ) => Metadata | Promise<Metadata>;
};

/**
 * Produces the per-page `<head>` Metadata for a route. Title, description and
 * the free-text metadata fields are template-allowed; the datasource context
 * behind them is loaded once, and only when something actually carries a
 * template.
 */
export async function resolvePageMetadata({
  pageData,
  path,
  fetchers = [],
  transform,
}: ResolvePageMetadataOptions): Promise<Metadata> {
  const rootProps: Record<string, unknown> | undefined = pageData?.root.props;
  const seo: Partial<SeoMetadata> | undefined = rootProps?._seo as
    | Partial<SeoMetadata>
    | undefined;
  const authoredMeta = rootProps?._meta as AuthoredPageMeta | undefined;
  const rootTitle = rootProps?.title as string | undefined;
  // Untitled pages carry the editor's defaultProps.title boilerplate; never
  // ship it as <title>/og:title.
  const rawTitle = rootTitle === DEFAULT_EDITOR_ROOT_TITLE ? undefined : rootTitle;
  const rawDescription = rootProps?.description as string | undefined;

  const templatedMeta = Object.keys(authoredMeta ?? {}).filter(
    (field) =>
      !FIXED_VOCABULARY_FIELDS.includes(field) &&
      carriesTemplate(authoredMeta?.[field]),
  );
  const needsTemplates =
    carriesTemplate(rawTitle) || carriesTemplate(rawDescription) || templatedMeta.length > 0;

  let title = rawTitle;
  let description = rawDescription;
  let meta = authoredMeta;

  if (needsTemplates && pageData) {
    const routeTemplateKeys = await loadRouteTemplateKeys();
    const referencedDatasourceIds = extractReferencedDatasourceIds(pageData);
    const context = await loadRemoteDatasourceContext({
      fetchImpl: fetch,
      pagePath: path,
      routeTemplateKeys,
      builtinFetchers: fetchers,
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

  const metadata = buildPageMetadata({
    seo: {
      title,
      description,
      siteName: seo?.siteName,
      siteDefaults: { ogImage: seo?.ogImage, ogLocale: seo?.ogLocale },
      meta,
    },
    path,
  });

  return transform
    ? transform(metadata, { pageData, path, title, description, meta: meta ?? {} })
    : metadata;
}
