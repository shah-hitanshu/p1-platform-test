import { componentNameFromPath } from '@pantheon-systems/p1-content-validator';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { BranchScopedInputSchema } from './shared-schemas.js';

export const listComponentsTool = defineTool({
  description:
    "List all Puck components registered in the site's component registry. Returns component names, provenance (site/upstream/overridden), field count, and any AI instructions. The special component __root__ describes the page-level root props accepted by root_props in create_page. Use this to discover what components and root fields are available before calling create_page.",
  inputSchema: BranchScopedInputSchema,
  annotations: { title: 'List components', readOnlyHint: true },
  mutates: false,
  handler: async (ctx, input) => {
    try {
      const docs = await ctx.apiClient.listDocuments(input.site_id, input.branch_id, {
        pathPrefix: '_registry/components/',
      });

      if (docs.documents.length === 0) {
        return formatResult('No components registered in this site. The site editor must be opened at least once to populate the registry.');
      }

      // Fetch each component's snapshot (N+1 is acceptable — called rarely, not in hot path)
      const componentLines: string[] = [];
      const counts = { site: 0, upstream: 0, overridden: 0 };

      await Promise.all(
        docs.documents.map(async (doc) => {
          // Never fall back to the path-derived name: paths are lowercased
          // server-side, so it would advertise a casing Puck cannot resolve
          // as if it were a usable component type. The descriptor's own
          // `name` is the only source of truth; without it the entry is
          // reported as unusable rather than guessed at.
          try {
            // Use doc.id (UUID) — NOT doc.path. The backend versions/latest route
            // performs a UUID-based lookup; passing a path would return 404.
            const version = await ctx.apiClient.getDocumentLatestVersion(
              input.site_id,
              input.branch_id,
              doc.id,
            );
            const descriptor = version.snapshot;
            if (typeof descriptor.name !== 'string' || descriptor.name === '') {
              componentLines.push(
                `- ${componentNameFromPath(doc.path)} [UNUSABLE — descriptor has no name; `
                  + 'reopen the editor or rerun the registry sync to repair it]',
              );
              return;
            }
            const name = descriptor.name;
            const provenance = typeof descriptor.provenance === 'string' ? descriptor.provenance : 'site';
            const fields = Array.isArray(descriptor.fields) ? descriptor.fields : [];
            const ai = descriptor.ai as { instructions?: string } | undefined;
            const label = typeof descriptor.label === 'string' ? descriptor.label : name;

            if (provenance in counts) counts[provenance as keyof typeof counts]++;

            const aiNote =
              ai?.instructions !== undefined && ai.instructions !== ''
                ? ` — AI: "${ai.instructions.slice(0, 60)}${ai.instructions.length > 60 ? '...' : ''}"`
                : '';
            const fieldNote = fields.length === 1 ? '1 field' : `${String(fields.length)} fields`;

            componentLines.push(`- ${name} (${label}) [${provenance}] — ${fieldNote}${aiNote}`);
          } catch {
            componentLines.push(
              `- ${componentNameFromPath(doc.path)} [error fetching descriptor]`,
            );
          }
        }),
      );

      componentLines.sort(); // Alphabetical order for readability

      const summary = `Components registered in this site (${String(docs.documents.length)} total — ${String(counts.site)} site, ${String(counts.upstream)} upstream, ${String(counts.overridden)} overridden):\n${componentLines.join('\n')}`;
      return formatResult(summary);
    } catch (error) {
      return formatError(error);
    }
  },
});
