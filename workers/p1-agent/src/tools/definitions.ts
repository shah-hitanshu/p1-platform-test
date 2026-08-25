import type OpenAI from 'openai';

/**
 * A provider-neutral tool specification — the single source of truth for tool specs.
 * Each transport converts it to its own wire format (`toOpenAiTools` here;
 * `toAnthropicTools` in providers/anthropic.ts). No tool lists sites or branches: both always
 * come from the editor context. Documents are not: the agent reads across the whole site and
 * is held to its write set when it edits.
 */
export interface RawTool {
  /** Tool name the model calls (must match a case in `executeTool`). */
  name: string;
  /** Human-readable description shown to the model. */
  description: string;
  /** JSON Schema for the tool's arguments (Anthropic-native `input_schema` shape). */
  input_schema: Record<string, unknown>;
}
const RAW_CCR_TOOLS: RawTool[] = [
  {
    name: 'list_documents',
    description: 'List the pages on this site. Use it to find a page the user named, or to see what else is on the site before making a change. Being able to read a page does not mean you may edit it — editing is limited to your write set.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
      },
      required: ['site_id', 'branch_id'],
    },
  },
  {
    name: 'list_components',
    description: 'List P1 components available for building a new page. Only needed when creating a new page — do not call when editing an existing page.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
      },
      required: ['site_id', 'branch_id'],
    },
  },
  {
    name: 'get_document',
    description: 'Get the full P1 document snapshot. Only call when you need the page structure and have not already fetched it in this turn — snapshots are not retained across turns.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
        document_path: { type: 'string', description: 'Document path, no leading slash — e.g. index' },
      },
      required: ['site_id', 'branch_id', 'document_path'],
    },
  },
  {
    name: 'check_edit_permission',
    description: 'Check if the agent can edit target regions on a document. MUST call before start_edit_session.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
        document_path: { type: 'string' },
        intent: { type: 'string', description: 'Human-readable description of what you intend to change' },
        target_regions: { type: 'array', items: { type: 'string' }, description: 'JSON paths of regions to edit, e.g. ["content.0", "content.1"]' },
      },
      required: ['site_id', 'branch_id', 'document_path', 'intent', 'target_regions'],
    },
  },
  {
    name: 'start_edit_session',
    description: 'Start an edit session and reserve regions. Requires prior check_edit_permission.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
        document_path: { type: 'string' },
        intent: { type: 'string' },
        target_regions: { type: 'array', items: { type: 'string' } },
      },
      required: ['site_id', 'branch_id', 'document_path', 'intent', 'target_regions'],
    },
  },
  {
    name: 'apply_document_edits',
    description: [
      'Apply edit operations to the document.',
      'Path uses dot-notation: "content.0.props.title" NOT "content[0]".',
      'Never rename or add keys — only change values. Field names must match the component schema exactly.',
      '',
      'Operation types:',
      '  replace — overwrite a value at path with content (e.g. change a prop value: path "content.0.props.title", content "New title").',
      '  add     — insert content into an array. Path ends with the target index (e.g. "content.2" inserts at index 2).',
      '  remove  — delete the element at path (e.g. "content.1" removes the second component).',
      '  move    — reorder a single element within an array. Path is the array (e.g. "content"), with fromIndex and toIndex.',
      '',
      'To reorder one component, prefer "move" — it is a single atomic operation. Only use a full-array "replace" on "content" when reordering many components at once.',
    ].join('\n'),
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
        document_path: { type: 'string' },
        edit_session_id: { type: 'string' },
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['add', 'remove', 'replace', 'move'] },
              path: { type: 'string' },
              content: {},
              fromIndex: { type: 'number', description: 'For move: source index in the array.' },
              toIndex: { type: 'number', description: 'For move: destination index in the array.' },
            },
            required: ['type', 'path'],
          },
        },
      },
      required: ['site_id', 'branch_id', 'document_path', 'edit_session_id', 'operations'],
    },
  },
  {
    name: 'complete_edit_session',
    description: 'Finalize a successful edit session. MUST call when done — do not leave sessions open.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
        document_path: { type: 'string' },
        edit_session_id: { type: 'string' },
      },
      required: ['site_id', 'branch_id', 'document_path', 'edit_session_id'],
    },
  },
  {
    name: 'abort_edit_session',
    description: 'Rollback an edit session. Use on conflict, user cancellation, or unexpected results.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
        document_path: { type: 'string' },
        edit_session_id: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['site_id', 'branch_id', 'document_path', 'edit_session_id'],
    },
  },
  {
    name: 'get_branch_presence',
    description: 'Get all actors currently active on a branch across all documents.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
      },
      required: ['site_id', 'branch_id'],
    },
  },
  {
    name: 'get_document_presence',
    description: 'Get presence information for a specific document.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
        document_path: { type: 'string' },
      },
      required: ['site_id', 'branch_id', 'document_path'],
    },
  },
  {
    name: 'list_page_templates',
    description: 'List the page templates a new page can be built from. Call before creating a page, so the page starts from the template that fits rather than from nothing. Returns each template\'s id, label, purpose and route shape — never its layout.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
      },
      required: ['site_id', 'branch_id'],
    },
  },
  {
    name: 'create_page',
    description: [
      'Create a brand-new page document. ONLY call after the user has explicitly confirmed they want a new page — never call for editing requests. No edit session needed.',
      '',
      'Two ways to create:',
      '  From a template — pass template_id and omit components. The page is scaffolded with the template\'s components, which you then fill in by editing their props.',
      '  Empty — pass components (may be an empty list) and omit template_id. Component types must be names returned by list_components; never invent or guess component names.',
      '',
      'template_id and components are mutually exclusive: a template supplies the components.',
      'With template_id, only root_props.title is applied — set any other root prop afterwards with apply_document_edits.',
      "A template's route shape decides where its pages live, so document_path is placed under it. Report the path the result gives back, not the one you asked for.",
    ].join('\n'),
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        branch_id: { type: 'string' },
        document_path: {
          type: 'string',
          description:
            "Path for the new page, no leading slash — e.g. about. With template_id, built from "
            + "the template's route shape.",
        },
        template_id: {
          type: 'string',
          description: 'Page template to build from, copied verbatim from list_page_templates.',
        },
        components: {
          type: 'array',
          description: 'Ordered list of P1 components for the page. Omit when template_id is given.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'Component name from list_components' },
              props: { type: 'object' },
              zone: { type: 'string' },
              parentId: { type: 'string' },
            },
            required: ['type', 'props'],
          },
        },
        root_props: { type: 'object', description: 'Root-level page props (e.g. title)' },
      },
      required: ['site_id', 'branch_id', 'document_path'],
    },
  },
];

// Tool definitions for web/media capabilities
const RAW_WEB_TOOLS: RawTool[] = [
  {
    name: 'list_media',
    description: 'List media files available in the site media library. Optionally filter by filename substring.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        search: { type: 'string', description: 'Optional filename substring filter' },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'fetch_page',
    description: 'Fetch a public web page and extract its title, meta description, headings, paragraphs, and images as structured text. Only works with public http/https URLs — not localhost or private IP ranges.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'The http or https URL to fetch' },
      },
      required: ['url'],
    },
  },
];

/**
 * Convert provider-neutral specs to OpenAI function-calling tools. The JSON Schema in
 * `input_schema` maps directly onto the function `parameters` field.
 */
export function toOpenAiTools(raw: RawTool[]): OpenAI.Chat.Completions.ChatCompletionFunctionTool[] {
  return raw.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

/** CCR capability tools, in the provider-neutral {@link RawTool} shape. */
export const CCR_TOOLS: RawTool[] = RAW_CCR_TOOLS;
/** Web/media tools (fetch_page, list_media), in the provider-neutral {@link RawTool} shape. */
export const WEB_TOOLS: RawTool[] = RAW_WEB_TOOLS;
