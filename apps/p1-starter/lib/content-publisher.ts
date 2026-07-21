import type {
  RemoteDatasourceFetcher,
  RemoteDatasourceFetcherParams,
} from "@pantheon-systems/puck-css/server";
import { PCCConvenienceFunctions } from "@pantheon-systems/cpub-react-sdk/server";
import { getFirstValue, savedValue } from "./fetcher-helpers";

const ARTICLE_ID_REGEX = /^[a-z0-9][a-z0-9:_-]*$/i;

function asArticleId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || !ARTICLE_ID_REGEX.test(trimmed)) return undefined;
  return trimmed;
}

function articleField(row: Record<string, unknown>, key: string): unknown {
  if (key in row) return row[key];
  const attrs = row.attributes;
  if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
    return (attrs as Record<string, unknown>)[key];
  }
  return undefined;
}

type ArticleListItem = {
  id: string;
  title: string;
  slug?: string;
  url?: string;
};

function mapArticleRow(row: Record<string, unknown>): ArticleListItem | null {
  const idValue =
    articleField(row, "id") ??
    articleField(row, "uuid") ??
    articleField(row, "nid") ??
    articleField(row, "drupal_internal__nid");
  const id =
    typeof idValue === "string"
      ? idValue
      : typeof idValue === "number"
        ? String(idValue)
        : "";
  const titleValue = articleField(row, "title");
  const slugValue = articleField(row, "slug") ?? articleField(row, "path");
  const urlValue = articleField(row, "url");
  const title = typeof titleValue === "string" ? titleValue : "";
  const slug = typeof slugValue === "string" ? slugValue : undefined;
  const url = typeof urlValue === "string" ? urlValue : undefined;
  if (!id || !title) return null;
  return { id, title, slug, url };
}

function arrayFromListPayload(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return [];
  const record = json as Record<string, unknown>;
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.results)) return record.results;
  if (Array.isArray(record.data)) return record.data;
  return [];
}

function resolveArticleId(params: RemoteDatasourceFetcherParams): string | undefined {
  const { searchParams, urlParams, savedPreviewParams } = params;
  return (
    asArticleId(getFirstValue(searchParams, "article")) ??
    asArticleId(getFirstValue(searchParams, "articleId")) ??
    asArticleId(getFirstValue(searchParams, "slug")) ??
    asArticleId(getFirstValue(searchParams, "id")) ??
    asArticleId(savedValue(savedPreviewParams, "article")) ??
    asArticleId(savedValue(savedPreviewParams, "articleId")) ??
    asArticleId(savedValue(savedPreviewParams, "slug")) ??
    asArticleId(savedValue(savedPreviewParams, "id")) ??
    asArticleId(urlParams.article) ??
    asArticleId(urlParams.articleId) ??
    asArticleId(urlParams.slug) ??
    asArticleId(urlParams.id)
  );
}

async function fetchContentPublisherArticle(
  id: string | undefined,
): Promise<Record<string, unknown>> {
  const validId = asArticleId(id);
  if (!validId) return {};
  try {
    const article = await PCCConvenienceFunctions.getArticleBySlugOrId(validId, {
      contentType: "TEXT_MARKDOWN",
    });
    if (article && typeof article === "object" && !Array.isArray(article)) {
      return article as unknown as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

async function fetchContentPublisherArticleList(): Promise<ArticleListItem[]> {
  try {
    const payload = await PCCConvenienceFunctions.getPaginatedArticles({
      pageSize: 200,
    });
    const rows = arrayFromListPayload(payload?.data ?? []);
    const out: ArticleListItem[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const item = mapArticleRow(row as Record<string, unknown>);
      if (item) out.push(item);
    }
    return out;
  } catch {
    return [];
  }
}

export const CONTENT_PUBLISHER_FETCHERS: RemoteDatasourceFetcher[] = [
  {
    id: "article",
    fetch: async (params) => fetchContentPublisherArticle(resolveArticleId(params)),
  },
  {
    id: "article_list",
    fetch: async () => ({ items: await fetchContentPublisherArticleList() }),
  },
];
