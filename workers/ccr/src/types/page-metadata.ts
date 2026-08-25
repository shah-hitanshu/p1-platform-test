/**
 * SEO metadata delivered on the content payload. Page-level tags (title,
 * description, canonical URL) are derived client-side from the snapshot in
 * `data`, typed against the app's own Puck config; only site-level values the
 * snapshot cannot provide are delivered here.
 */
export interface SeoMetadata {
  /** Populates the og:site_name tag. Site-wide, delivered per-page. */
  siteName?: string;
  /** Site-wide og:image fallback for pages that leave the field empty. */
  ogImage?: string;
  /** Site-wide og:locale fallback for pages that leave the field empty. */
  ogLocale?: string;
}

/**
 * Response body for GET /api/sites/{siteId}/content/{documentPath}.
 */
export interface PageContent {
  documentId: string;
  metadata: SeoMetadata;
  path: string;
  data: unknown;
  branchId: string;
  branchName: string;
  isMainBranch: boolean;
  versionNumber: number;
  versionCreatedAt: string;
  etag: string;
  inherited?: boolean;
}
