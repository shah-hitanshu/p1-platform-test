import type { Metadata } from "next";
import { OG_TYPES, TWITTER_CARDS } from "./seo-metadata.consts";

/**
 * Authored page metadata, stored at `root.props._meta`. Empty means inherit: a
 * blank field resolves from the page's own title/description at render time
 * rather than having been copied when the page was created.
 */
export interface PageMetaFields {
  ogTitle?: string;
  ogDescription?: string;
  ogType?: string;
  ogImage?: string;
  ogLocale?: string;
  twitterCard?: string;
  twitterTitle?: string;
  twitterImage?: string;
}

/**
 * Head-side metadata inputs. Title, description, and canonical are derived
 * client-side (root props, request path); only siteName arrives from the
 * backend's SeoMetadata payload.
 */
export interface PageHeadMetadata {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  siteName?: string;
  meta?: PageMetaFields;
}

/**
 * The editor offers these as dropdowns built from the same lists, but the API
 * and MCP write the props directly, so the validation stays.
 */
function oneOf<T extends readonly string[]>(
  allowed: T,
  authored: string | undefined,
  fallback: T[number],
): T[number] {
  return authored && (allowed as readonly string[]).includes(authored)
    ? (authored as T[number])
    : fallback;
}

/** Drops absent values so no empty tag is emitted. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== ""),
  ) as T;
}

/**
 * Maps head metadata to the page's <head> Metadata. Next replaces (not
 * deep-merges) a page's openGraph over the layout's, so og:type and the env
 * og:site_name fallback must be declared here. A relative canonical is emitted
 * only when NEXT_PUBLIC_SITE_URL is configured to resolve it — otherwise Next
 * would resolve it against a localhost default, and a wrong canonical is worse
 * than none. An empty title is treated as absent.
 *
 * Social tags resolve as: authored value → derived from title/description →
 * omit. The template and site-default tiers are not wired up yet.
 */
export function buildPageMetadata({
  seo,
  path,
}: {
  seo?: PageHeadMetadata;
  path: string;
}): Metadata {
  const meta = seo?.meta ?? {};

  const title = seo?.title || undefined;
  const description = seo?.description || undefined;
  const canonical =
    seo?.canonicalUrl ?? (process.env.NEXT_PUBLIC_SITE_URL ? path : undefined);

  const ogImage = meta.ogImage || undefined;
  const twitterTitle = meta.twitterTitle || meta.ogTitle || title;
  const twitterImage = meta.twitterImage || ogImage;

  return compact({
    title,
    description,
    alternates: canonical ? { canonical } : undefined,

    openGraph: compact({
      type: oneOf(OG_TYPES, meta.ogType, "website"),
      title: meta.ogTitle || title,
      description: meta.ogDescription || description,
      url: canonical,
      siteName: seo?.siteName ?? process.env.NEXT_PUBLIC_SITE_NAME,
      images: ogImage,
      locale: meta.ogLocale || undefined,
    }),

    // Without a card style X renders nothing, so it is always set when there is
    // anything to show — but an untitled, imageless page gets no twitter tags.
    twitter:
      twitterTitle || twitterImage
        ? compact({
            card: oneOf(
              TWITTER_CARDS,
              meta.twitterCard,
              twitterImage ? "summary_large_image" : "summary",
            ),
            title: twitterTitle,
            images: twitterImage,
          })
        : undefined,
  });
}
