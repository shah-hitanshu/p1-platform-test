import { SiteDetail, SiteSettings } from '../../shared/api-client.js';

export function formatSiteConfig(site: SiteDetail): string {
  // An empty list is not "unrestricted": buildCorsPatterns falls back to
  // wildcard-all while resolveRedirectOrigin fails closed, so the two consumers
  // disagree. Reporting only the CORS half would hide the broken sign-in.
  const origins =
    site.allowedOrigins.length > 0
      ? site.allowedOrigins.join(', ')
      : '(none configured — CORS accepts any origin, but login redirects are refused)';
  return (
    `Site "${site.name}"\n`
    + `  site_id: ${site.id}\n`
    + `  public URL: ${site.url ?? '(not set)'}\n`
    + `  pantheon_site_id: ${site.pantheonSiteId ?? '(not linked)'}\n`
    + `  allowed origins: ${origins}\n`
    + `  workflow settings: ${JSON.stringify(site.workflowSettings)}`
  );
}

export function formatSiteSettings(result: {
  settings: SiteSettings | null;
  localeCounts?: Record<string, number>;
}): string {
  const s = result.settings;
  if (s === null) {
    return 'Site not found.';
  }
  const lines = [
    'Site settings',
    `  cache TTL (main): ${String(s.cacheTtlMain ?? '(default)')}s`,
    `  cache TTL (workstream): ${String(s.cacheTtlBranch ?? '(default)')}s`,
    `  og:image: ${s.ogImage ?? '(not set)'}`,
    `  og:locale: ${s.ogLocale ?? '(not set)'}`,
  ];
  if (s.locales === undefined) {
    lines.push('  localization: (not localized)');
  } else {
    lines.push(
      `  localization: ${s.locales.markets.join(', ')} (policy: ${s.locales.policy})`,
    );
  }
  if (result.localeCounts !== undefined) {
    const counts = Object.entries(result.localeCounts)
      .map(([locale, n]) => `${locale}=${String(n)}`)
      .join(', ');
    lines.push(`  documents per locale: ${counts}`);
  }
  return lines.join('\n');
}
