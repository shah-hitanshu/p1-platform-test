/**
 * User-facing MCP text says "workstream", never "branch".
 *
 * Tool names and parameter keys keep the older "branch" spelling because they
 * are the wire contract; only the prose an LLM reads back to a user is checked.
 *
 * Three surfaces carry that prose and all three are covered here: the tool
 * description, the schema (including nested and wrapped schemas), and the text
 * a handler actually returns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types';
import { allTools } from '../../src/tools/index.js';

const BRANCH_WORD = /\b[Bb]ranch(es)?\b/;

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/**
 * Descriptions can sit behind array/optional/default wrappers and inside nested
 * object schemas — `ConflictResolutionSchema.strategy` is reachable only as the
 * element type of an optional array — so unwrap and recurse rather than reading
 * the top level of `shape`.
 */
function fieldDescriptions(schema: unknown, path = ''): { path: string; text: string }[] {
  const def = (schema as { _def?: { typeName?: string } })._def;
  if (def === undefined) return [];

  const inner =
    (schema as { unwrap?: () => unknown }).unwrap?.() ??
    (def as { innerType?: unknown; type?: unknown }).innerType ??
    (def as { type?: unknown }).type;

  const own = (schema as { description?: string }).description;
  const here = own === undefined ? [] : [{ path, text: own }];

  const shape = (schema as { shape?: unknown }).shape;
  if (typeof shape === 'object' && shape !== null) {
    return here.concat(
      Object.entries(shape as Record<string, unknown>).flatMap(([key, field]) =>
        fieldDescriptions(field, path === '' ? key : `${path}.${key}`),
      ),
    );
  }

  // Array element types, plus optional/default/nullable wrappers. Only an array
  // marks the path — a wrapper describes the same field, not a new one.
  if (inner !== undefined && typeof inner === 'object') {
    const isArray = def.typeName === 'ZodArray';
    return here.concat(fieldDescriptions(inner, isArray ? `${path}[]` : path));
  }

  return here;
}

/**
 * The prose this repo authors, separated from backend data passed through.
 * A JSON result carries wire keys (`branchId`) and backend values (a workstream
 * a user chose to name "branch") that are deliberately out of scope; the prose
 * lives in `message` fields. A plain-string result is prose end to end.
 */
function authoredProse(result: CallToolResult): string {
  const text = (result.content as { type: string; text?: string }[])
    .map((part) => part.text ?? '')
    .join('\n');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }

  const messages: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'message' && typeof value === 'string') messages.push(value);
      else walk(value);
    }
  };
  walk(parsed);
  return messages.join('\n');
}

describe('MCP terminology', () => {
  const entries = Object.entries(allTools);

  it('walks nested schemas, so the per-tool checks are not vacuous', () => {
    const paths = entries.flatMap(([, tool]) =>
      fieldDescriptions(tool.inputSchema).map((d) => d.path),
    );
    expect(paths.length).toBeGreaterThan(100);
    // Reachable only by unwrapping an optional array and recursing into its element.
    expect(paths).toContain('conflict_resolutions[].strategy');
  });

  it.each(entries)('%s has no "branch" in its description', (_name, tool) => {
    expect(tool.description).not.toMatch(BRANCH_WORD);
  });

  it.each(entries)('%s has no "branch" in its title', (_name, tool) => {
    expect(tool.annotations?.title ?? '').not.toMatch(BRANCH_WORD);
  });

  it.each(entries)('%s has no "branch" in its field descriptions', (_name, tool) => {
    for (const { path, text } of fieldDescriptions(tool.inputSchema)) {
      expect(`${path}: ${text}`).not.toMatch(BRANCH_WORD);
    }
  });
});

/**
 * Handler output is the text the client echoes back to the user — the original
 * symptom in PCC-3865 — so it is checked by running the handlers, not by reading
 * source. Each tool is driven twice: against an empty backend (the "nothing
 * found" messages) and a populated one.
 */
describe('MCP terminology in handler output', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const workstreamFixture = {
    id: 'b1000000-0000-0000-0000-000000000001',
    siteId: 'site-1',
    name: '2027 Rebrand',
    status: 'active',
    isMain: false,
    createdById: 'agent-1',
    createdByType: 'agent',
    createdAt: '2026-09-09T00:00:00Z',
    updatedAt: '2026-09-09T00:00:00Z',
  };

  /** Every collection key any listing tool might read, so one mock serves all of them. */
  const emptyCollections = {
    branches: [],
    datasources: [],
    queries: [],
    templates: [],
    structures: [],
    documents: [],
    components: [],
    versions: [],
    mergeRequests: [],
    presence: [],
    actors: [],
    documentPresence: [],
    variants: [],
    sites: [],
  };

  const populated = {
    ...workstreamFixture,
    ...emptyCollections,
    branches: [workstreamFixture, { ...workstreamFixture, id: 'b1000000-0000-0000-0000-00000000ma1n', name: 'main', isMain: true }],
    message: 'ok',
  };

  async function loadHandlers(): Promise<Record<string, (input?: unknown) => Promise<CallToolResult>>> {
    const { McpApiClient } = await import('../../src/shared/api-client.js');
    const { createTestHandlers } = await import('../helpers/tool-handlers.js');
    return createTestHandlers(
      new McpApiClient({ baseUrl: 'http://localhost:8787', agentId: 'agent-1', agentApiKey: 'aak_test' }),
    );
  }

  const input = {
    site_id: 'site-1',
    branch_id: 'b1000000-0000-0000-0000-000000000001',
    source_branch_id: 'b1000000-0000-0000-0000-000000000001',
    target_branch_id: 'b1000000-0000-0000-0000-00000000ma1n',
    name: '2027 Rebrand',
    document_path: '/home',
    structure_id: 'structure-1',
    merge_request_id: 'mr-1',
    version_id: 'version-1',
    query_name: 'q',
    document_id: 'doc-1',
    edit_session_id: 'session-1',
    locale: 'fr',
    operations: [],
    target_regions: [],
    intent: 'edit',
  };

  const toolNames = Object.keys(allTools);

  it.each(toolNames)('%s returns no "branch" against an empty backend', async (name) => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(emptyCollections),
    });

    expect(authoredProse(await handlers[name](input))).not.toMatch(BRANCH_WORD);
  });

  it.each(toolNames)('%s returns no "branch" against a populated backend', async (name) => {
    const handlers = await loadHandlers();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(populated),
    });

    expect(authoredProse(await handlers[name](input))).not.toMatch(BRANCH_WORD);
  });
});
