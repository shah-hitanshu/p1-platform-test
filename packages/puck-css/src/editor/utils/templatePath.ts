import type { TemplateSummary } from '../../features/content-type-templates/types.js';

/**
 * Resolve the template being edited from a document path. Templates are stored
 * as documents at `_registry/templates/<name>`; returns the matching template
 * (by name) or null for ordinary pages.
 */
export function templateFromRegistryPath(
  path: string | undefined | null,
  templates: TemplateSummary[] | undefined,
): TemplateSummary | null {
  if (!path || !templates) return null;
  const match = path.match(/^_registry\/templates\/(.+)$/);
  if (!match) return null;
  return templates.find((t) => t.name === match[1]) ?? null;
}
