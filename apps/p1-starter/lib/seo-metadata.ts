import type { Metadata } from "next";

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
}

/**
 * Maps head metadata to the page's <head> Metadata. Next replaces (not
 * deep-merges) a page's openGraph over the layout's, so og:type and the env
 * og:site_name fallback must be declared here. A relative canonical is emitted
 * only when NEXT_PUBLIC_SITE_URL is configured to resolve it — otherwise Next
 * would resolve it against a localhost default, and a wrong canonical is worse
 * than none. An empty title is treated as absent.
 */
export function buildPageMetadata({
  seo,
  path,
}: {
  seo?: PageHeadMetadata;
  path: string;
}): Metadata {
  const { description, canonicalUrl } = seo ?? {};
  const title = seo?.title || undefined;
  const siteName = seo?.siteName ?? process.env.NEXT_PUBLIC_SITE_NAME;
  const canonical =
    canonicalUrl ?? (process.env.NEXT_PUBLIC_SITE_URL ? path : undefined);

  return {
    title,
    description,
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: {
      type: "website",
      title,
      description,
      ...(canonical ? { url: canonical } : {}),
      ...(siteName ? { siteName } : {}),
    },
  };
}
