import z from 'zod';
import { generateULID } from '../../shared/types/generate-ulid.js';
import { formatValidationError, validateOps } from '../shared/validate-ops.functions.js';
import { defineTool } from '../shared/define-tools.functions.js';
import { formatError, formatResult } from '../shared/format-mcp-responses.functions.js';
import { BranchScopedInputSchema } from './shared-schemas.js';

const CreatePageInputSchema = BranchScopedInputSchema.extend({
  document_path: z.string().describe('Path for the new page (e.g. "about" or "products/widget"). Must not start with _registry/.'),
  template_id: z.string().optional().describe('Optional template ID to create page from (get ID from list_templates)'),
  components: z.array(z.object({
    type: z.string().describe('Component type name (from list_components)'),
    props: z.record(z.unknown()).describe('Component props matching the registered fields'),
    zone: z.string().optional().describe('Slot field name when placing in a nested slot (requires parentId)'),
    parentId: z.string().optional().describe('ID of the parent component for slot placement (must match a component\'s generated id)'),
  })).describe('Components to place on the page, in order'),
  root_props: z.record(z.unknown()).optional().describe('Page-level root props'),
});

interface PuckComponent {
  type: string;
  props: Record<string, unknown> & { id: string };
}

export const createPageTool = defineTool({
  description:
    'Create a new page with a structured set of Puck components. Use list_components first to discover available component types and their field schemas. Optionally specify template_id (from list_templates) to create a page from a template. Each component is given a unique ID automatically. Returns the new document path and ID.',
  inputSchema: CreatePageInputSchema,
  annotations: { title: 'Create page', destructiveHint: false, idempotentHint: false },
  mutates: true,
  handler: async (ctx, input) => {
    try {
      // The _registry/ prefix is reserved whether or not the caller writes a
      // leading slash, so compare against the path with any leading slash removed.
      if (input.document_path.replace(/^\//, '').startsWith('_registry/')) {
        return formatError(
          new Error(
            'Cannot create pages at the _registry/ path prefix — this is reserved for system use.',
          ),
        );
      }

      if (input.template_id !== undefined && input.template_id !== '') {
        if (input.components.length > 0) {
          return formatError(
            new Error(
              'Creating from a template takes its structure from the template — components '
              + 'cannot be supplied alongside template_id. Create the page from the template '
              + 'first, then add components afterward via apply_document_edits.',
            ),
          );
        }

        const title = typeof input.root_props?.title === 'string' ? input.root_props.title : undefined;
        const { documentId, documentPath } = await ctx.apiClient.createDocument(
          input.site_id,
          input.branch_id,
          input.document_path,
          undefined,
          input.template_id,
          undefined,
          title,
        );

        return formatResult({
          message: `Page created at "${documentPath}".`,
          documentPath,
          documentId,
        });
      }

      // Validate component types and props against the registry before writing.
      // Construct synthetic add ops so we can reuse validateOps from the library.
      // Only runs when enableValidation is set on the client config (production).
      if (ctx.apiClient.validationEnabled) {
        try {
          const registry = await ctx.apiClient.fetchRegistrySchemas(input.site_id, input.branch_id);
          const syntheticOps = input.components.map((component, i) => ({
            type: 'add' as const,
            path: `content.${String(i)}`,
            content: {
              type: component.type,
              props: { id: generateULID(), ...component.props },
            },
          }));
          const validationResult = validateOps({
            operations: syntheticOps,
            registry,
          });
          if (validationResult.errors.length > 0) {
            return formatValidationError(validationResult.errors);
          }
        } catch (error: unknown) {
          // Registry fetch failed — proceed without validation
          void error;
        }
      }

      // Build valid Puck Data
      const content: PuckComponent[] = [];
      const zones: Record<string, PuckComponent[]> = {};

      for (const component of input.components) {
        const id = generateULID();
        const instance: PuckComponent = {
          type: component.type,
          props: { ...component.props, id },
        };

        if (component.parentId !== undefined && component.zone !== undefined) {
          const zoneKey = `${component.parentId}:${component.zone}`;
          zones[zoneKey] ??= [];
          zones[zoneKey].push(instance);
        } else {
          content.push(instance);
        }
      }

      const puckData = {
        content,
        root: { props: input.root_props ?? {} },
        ...(Object.keys(zones).length > 0 && { zones }),
      };

      const { documentId, documentPath } = await ctx.apiClient.createDocument(
        input.site_id,
        input.branch_id,
        input.document_path,
        puckData,
      );

      return formatResult({
        message: `Page created at "${documentPath}".`,
        documentPath,
        documentId,
        componentCount:
          content.length
          + Object.values(zones).reduce((n, arr) => n + arr.length, 0),
      });
    } catch (error) {
      return formatError(error);
    }
  },
});
