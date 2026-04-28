import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validatePublicUrl, executeTool, WEB_TOOLS, CSS_TOOLS } from './tools.js';
import type { McpApiClient } from './css-api.js';

// ---------------------------------------------------------------------------
// validatePublicUrl
// ---------------------------------------------------------------------------

describe('validatePublicUrl', () => {
  it('accepts a plain https URL', () => {
    const url = validatePublicUrl('https://example.com/page');
    expect(url.hostname).toBe('example.com');
  });

  it('accepts a plain http URL', () => {
    const url = validatePublicUrl('http://example.com/');
    expect(url.protocol).toBe('http:');
  });

  it('throws on a non-URL string', () => {
    expect(() => validatePublicUrl('not a url')).toThrow('Invalid URL');
  });

  it('throws on a ftp:// URL', () => {
    expect(() => validatePublicUrl('ftp://example.com')).toThrow('http or https');
  });

  it('throws on localhost', () => {
    expect(() => validatePublicUrl('http://localhost:8080')).toThrow('localhost');
  });

  it('throws on 127.x.x.x', () => {
    expect(() => validatePublicUrl('http://127.0.0.1')).toThrow('private IP');
  });

  it('throws on 127.1.2.3', () => {
    expect(() => validatePublicUrl('http://127.1.2.3')).toThrow('private IP');
  });

  it('throws on 10.x.x.x', () => {
    expect(() => validatePublicUrl('http://10.0.0.1/secret')).toThrow('private IP');
  });

  it('throws on 192.168.x.x', () => {
    expect(() => validatePublicUrl('http://192.168.1.100')).toThrow('private IP');
  });

  it('throws on 172.16.x.x', () => {
    expect(() => validatePublicUrl('http://172.16.0.1')).toThrow('private IP');
  });

  it('throws on 172.31.x.x', () => {
    expect(() => validatePublicUrl('http://172.31.255.255')).toThrow('private IP');
  });

  it('does NOT throw on 172.15.x.x (just outside the private range)', () => {
    expect(() => validatePublicUrl('http://172.15.0.1')).not.toThrow();
  });

  it('does NOT throw on 172.32.x.x (just outside the private range)', () => {
    expect(() => validatePublicUrl('http://172.32.0.1')).not.toThrow();
  });

  it('does NOT throw on a public IP like 8.8.8.8', () => {
    expect(() => validatePublicUrl('http://8.8.8.8')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// WEB_TOOLS shape
// ---------------------------------------------------------------------------

describe('WEB_TOOLS', () => {
  it('exports exactly two tools', () => {
    expect(WEB_TOOLS).toHaveLength(2);
  });

  it('has list_media as first tool with required site_id', () => {
    const tool = WEB_TOOLS[0];
    expect(tool.name).toBe('list_media');
    expect(tool.input_schema.required).toContain('site_id');
  });

  it('has fetch_page as second tool with required url', () => {
    const tool = WEB_TOOLS[1];
    expect(tool.name).toBe('fetch_page');
    expect(tool.input_schema.required).toContain('url');
  });
});

// ---------------------------------------------------------------------------
// executeTool — list_media
// ---------------------------------------------------------------------------

describe('executeTool list_media', () => {
  const stubCssApi = {} as McpApiClient;
  const webConfig = { token: 'test-token', mediaWorkerUrl: 'https://media.example.com' };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when webConfig is not provided', async () => {
    await expect(
      executeTool('list_media', { site_id: 'site-1' }, stubCssApi, 'user-1'),
    ).rejects.toThrow('not available');
  });

  it('calls the media worker with siteId and Bearer token', async () => {
    const mockData = [{ key: 'k', url: 'https://cdn/img.jpg', filename: 'img.jpg', size: 100, lastModified: '2025-01-01' }];
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await executeTool('list_media', { site_id: 'site-1' }, stubCssApi, 'user-1', webConfig);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain('siteId=site-1');
    expect(calledUrl).toContain('https://media.example.com/media');
    expect((calledInit.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
    expect(result).toEqual(mockData);
  });

  it('includes search param when provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    vi.stubGlobal('fetch', mockFetch);

    await executeTool('list_media', { site_id: 'site-1', search: 'logo' }, stubCssApi, 'user-1', webConfig);

    const [calledUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain('search=logo');
  });

  it('omits search param when not provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    vi.stubGlobal('fetch', mockFetch);

    await executeTool('list_media', { site_id: 'site-1' }, stubCssApi, 'user-1', webConfig);

    const [calledUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).not.toContain('search=');
  });

  it('throws on non-2xx response from media worker', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      executeTool('list_media', { site_id: 'site-1' }, stubCssApi, 'user-1', webConfig),
    ).rejects.toThrow('403');
  });
});

// ---------------------------------------------------------------------------
// executeTool — fetch_page
// ---------------------------------------------------------------------------

describe('executeTool fetch_page', () => {
  const stubCssApi = {} as McpApiClient;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws on a private IP URL', async () => {
    await expect(
      executeTool('fetch_page', { url: 'http://192.168.0.1' }, stubCssApi, 'user-1'),
    ).rejects.toThrow('private IP');
  });

  it('throws on localhost URL', async () => {
    await expect(
      executeTool('fetch_page', { url: 'http://localhost/admin' }, stubCssApi, 'user-1'),
    ).rejects.toThrow('localhost');
  });

  it('throws when fetch returns non-2xx', async () => {
    // HTMLRewriter is a Cloudflare runtime global — stub both fetch and HTMLRewriter
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      executeTool('fetch_page', { url: 'https://example.com/missing' }, stubCssApi, 'user-1'),
    ).rejects.toThrow('404');
  });

  it('extracts content via HTMLRewriter and returns a string', async () => {
    // Minimal HTMLRewriter stub that simulates text extraction
    class FakeHTMLRewriter {
      private handlers: Array<{ selector: string; handler: { text?: (c: { text: string; lastInTextNode: boolean }) => void; element?: (el: { getAttribute: (k: string) => string | null; tagName: string }) => void } }> = [];

      on(selector: string, handler: { text?: (c: { text: string; lastInTextNode: boolean }) => void; element?: (el: { getAttribute: (k: string) => string | null; tagName: string }) => void }) {
        this.handlers.push({ selector, handler });
        return this;
      }

      transform(response: Response) {
        return {
          text: async () => {
            // Drive title handler
            for (const { selector, handler } of this.handlers) {
              if (selector === 'title' && handler.text) {
                handler.text({ text: 'My Page Title', lastInTextNode: false });
                handler.text({ text: '', lastInTextNode: true });
              }
              if (selector === 'meta[name="description"]' && handler.element) {
                handler.element({
                  getAttribute: (k: string) => k === 'content' ? 'A great description' : null,
                  tagName: 'meta',
                });
              }
              if (selector === 'h1,h2,h3,h4,h5,h6' && handler.element) {
                handler.element({ getAttribute: () => null, tagName: 'h1' });
              }
              if (selector === 'h1,h2,h3,h4,h5,h6' && handler.text) {
                handler.text({ text: 'Main Heading', lastInTextNode: false });
                handler.text({ text: '', lastInTextNode: true });
              }
              if (selector === 'p' && handler.text) {
                handler.text({ text: 'First paragraph.', lastInTextNode: false });
                handler.text({ text: '', lastInTextNode: true });
              }
              if (selector === 'img' && handler.element) {
                handler.element({
                  getAttribute: (k: string) => k === 'src' ? 'https://cdn/img.png' : k === 'alt' ? 'A photo' : null,
                  tagName: 'img',
                });
              }
            }
            return '';
          },
        };
      }
    }

    vi.stubGlobal('HTMLRewriter', FakeHTMLRewriter);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    const result = await executeTool('fetch_page', { url: 'https://example.com/' }, stubCssApi, 'user-1') as string;

    expect(typeof result).toBe('string');
    expect(result).toContain('My Page Title');
    expect(result).toContain('A great description');
    expect(result).toContain('Main Heading');
    expect(result).toContain('First paragraph.');
    expect(result).toContain('https://cdn/img.png');
    expect(result).toContain('A photo');
  });

  it('caps output at 5000 characters', async () => {
    const longText = 'x'.repeat(6000);

    class FakeHTMLRewriter {
      on(_selector: string, handler: { text?: (c: { text: string; lastInTextNode: boolean }) => void }) {
        if (handler.text) {
          // p handler will receive a very long paragraph
          handler.text({ text: longText, lastInTextNode: false });
          handler.text({ text: '', lastInTextNode: true });
        }
        return this;
      }
      transform(_response: Response) {
        return { text: async () => '' };
      }
    }

    vi.stubGlobal('HTMLRewriter', FakeHTMLRewriter);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const result = await executeTool('fetch_page', { url: 'https://example.com/' }, stubCssApi, 'user-1') as string;
    expect(result.length).toBeLessThanOrEqual(5000);
  });
});

// ---------------------------------------------------------------------------
// executeTool — unknown tool
// ---------------------------------------------------------------------------

describe('executeTool unknown tool', () => {
  it('throws on an unrecognised tool name', async () => {
    const stubCssApi = {} as McpApiClient;
    await expect(
      executeTool('nonexistent_tool', {}, stubCssApi, 'user-1'),
    ).rejects.toThrow('Unknown tool: nonexistent_tool');
  });
});

// ---------------------------------------------------------------------------
// apply_document_edits — key-validation guard
// ---------------------------------------------------------------------------

describe('executeTool apply_document_edits key-validation', () => {
  const siteId = 'site-1';
  const branchId = 'branch-1';
  const documentPath = '/index';
  const editSessionId = 'session-1';

  const existingSnapshot = {
    content: [
      {
        type: 'Hero',
        props: { id: 'abc', text: 'Hello world', visible: true },
      },
    ],
  };

  function makeCssApi(overrides: Partial<McpApiClient> = {}): McpApiClient {
    return {
      listDocuments: vi.fn().mockResolvedValue({
        documents: [{ id: 'doc-1', path: 'index', createdAt: '' }],
      }),
      getDocumentLatestVersion: vi.fn().mockResolvedValue({
        id: 'ver-1',
        documentId: 'doc-1',
        versionNumber: 1,
        snapshot: existingSnapshot,
      }),
      applyEdits: vi.fn().mockResolvedValue({ success: true }),
      ...overrides,
    } as unknown as McpApiClient;
  }

  const baseInput = {
    site_id: siteId,
    branch_id: branchId,
    document_path: documentPath,
    edit_session_id: editSessionId,
  };

  it('replace with a renamed key throws with a descriptive message', async () => {
    const cssApi = makeCssApi();
    await expect(
      executeTool('apply_document_edits', {
        ...baseInput,
        operations: [
          { type: 'replace', path: 'content.0.props', content: { id: 'abc', label: 'Hello', visible: true } },
        ],
      }, cssApi, 'user-1'),
    ).rejects.toThrow(/Invalid key\(s\) at "content\.0\.props": "label".*Valid keys are:.*text/);
  });

  it('replace with correct keys passes and forwards to applyEdits', async () => {
    const cssApi = makeCssApi();
    await executeTool('apply_document_edits', {
      ...baseInput,
      operations: [
        { type: 'replace', path: 'content.0.props', content: { id: 'abc', text: 'Updated', visible: false } },
      ],
    }, cssApi, 'user-1');
    expect(cssApi.applyEdits).toHaveBeenCalledOnce();
  });

  it('replace on an array where items have a renamed key throws', async () => {
    const cssApi = makeCssApi();
    await expect(
      executeTool('apply_document_edits', {
        ...baseInput,
        operations: [
          {
            type: 'replace',
            path: 'content',
            content: [
              { type: 'Hero', props: { id: 'abc', label: 'Bad key', visible: true } },
            ],
          },
        ],
      }, cssApi, 'user-1'),
    ).rejects.toThrow(/Invalid key\(s\) at "content\.0\.props": "label"/);
  });

  it('add to an array where the new item has a renamed key throws', async () => {
    const cssApi = makeCssApi({
      getDocumentLatestVersion: vi.fn().mockResolvedValue({
        id: 'ver-1',
        documentId: 'doc-1',
        versionNumber: 1,
        snapshot: {
          content: [
            { type: 'Hero', props: { id: 'abc', text: 'Hello', visible: true } },
          ],
        },
      }),
    });
    await expect(
      executeTool('apply_document_edits', {
        ...baseInput,
        operations: [
          { type: 'add', path: 'content.1', content: { type: 'Hero', props: { id: 'def', label: 'Bad', visible: false } } },
        ],
      }, cssApi, 'user-1'),
    ).rejects.toThrow(/Invalid key\(s\) at "content\.1\.props": "label"/);
  });

  it('add to an array with correct keys passes and forwards to applyEdits', async () => {
    const cssApi = makeCssApi();
    await executeTool('apply_document_edits', {
      ...baseInput,
      operations: [
        { type: 'add', path: 'content.1', content: { type: 'Hero', props: { id: 'def', text: 'New', visible: false } } },
      ],
    }, cssApi, 'user-1');
    expect(cssApi.applyEdits).toHaveBeenCalledOnce();
  });

  it('validation is skipped and edit proceeds when document fetch fails', async () => {
    const cssApi = makeCssApi({
      listDocuments: vi.fn().mockRejectedValue(new Error('Network timeout')),
    });
    await executeTool('apply_document_edits', {
      ...baseInput,
      operations: [
        { type: 'replace', path: 'content.0.props', content: { id: 'abc', label: 'Bad key', visible: true } },
      ],
    }, cssApi, 'user-1');
    expect(cssApi.applyEdits).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// executeTool — list_components formatting
// ---------------------------------------------------------------------------

describe('executeTool list_components', () => {
  function makeCssApi(components: unknown[]): McpApiClient {
    return {
      listComponents: vi.fn().mockResolvedValue({ components }),
    } as unknown as McpApiClient;
  }

  it('returns only name, defaultProps, and instructions — drops other metadata', async () => {
    const cssApi = makeCssApi([
      {
        name: 'Stats',
        label: 'Stats Section',
        defaultProps: { items: [{ text: '' }], columns: '3' },
        fields: [{ type: 'array', name: 'items', label: 'Items' }],
        provenance: { source: 'somewhere' },
        descriptorHash: 'abc123',
        ai: { instructions: 'Use for displaying key metrics.' },
      },
    ]);

    const result = await executeTool(
      'list_components',
      { site_id: 'site-1', branch_id: 'branch-1' },
      cssApi,
      'user-1',
    ) as Array<Record<string, unknown>>;

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'Stats',
      defaultProps: { items: [{ text: '' }], columns: '3' },
      instructions: 'Use for displaying key metrics.',
    });
    expect(result[0]).not.toHaveProperty('label');
    expect(result[0]).not.toHaveProperty('provenance');
    expect(result[0]).not.toHaveProperty('descriptorHash');
    expect(result[0]).not.toHaveProperty('fields');
    expect(result[0]).not.toHaveProperty('ai');
  });

  it('omits instructions when ai.instructions is not present', async () => {
    const cssApi = makeCssApi([
      {
        name: 'Hero',
        label: 'Hero',
        defaultProps: { title: '' },
      },
    ]);

    const result = await executeTool(
      'list_components',
      { site_id: 'site-1', branch_id: 'branch-1' },
      cssApi,
      'user-1',
    ) as Array<Record<string, unknown>>;

    expect(result[0]).toEqual({
      name: 'Hero',
      defaultProps: { title: '' },
    });
    expect(result[0]).not.toHaveProperty('instructions');
  });

  it('omits instructions when ai exists but has no instructions field', async () => {
    const cssApi = makeCssApi([
      {
        name: 'Hero',
        defaultProps: { title: '' },
        ai: { someOtherField: 'value' },
      },
    ]);

    const result = await executeTool(
      'list_components',
      { site_id: 'site-1', branch_id: 'branch-1' },
      cssApi,
      'user-1',
    ) as Array<Record<string, unknown>>;

    expect(result[0]).not.toHaveProperty('instructions');
  });
});

// ---------------------------------------------------------------------------
// executeTool — create_page prop validation
// ---------------------------------------------------------------------------

describe('executeTool create_page prop validation', () => {
  const siteId = 'site-1';
  const branchId = 'branch-1';

  function makeCssApi(components: unknown[]): McpApiClient {
    return {
      listComponents: vi.fn().mockResolvedValue({ components }),
      createDocument: vi.fn().mockResolvedValue({ documentId: 'doc-1', documentPath: 'about', versionId: 'v-1' }),
      canAgentEdit: vi.fn().mockResolvedValue({ canEdit: true }),
      startAgentEdit: vi.fn().mockResolvedValue({ editSessionId: 'session-1', checkpointId: 'ck-1', expiresAt: '', reservedRegions: [] }),
      applyEdits: vi.fn().mockResolvedValue({ success: true }),
      completeAgentEdit: vi.fn().mockResolvedValue({ success: true, checkpointId: 'ck-1' }),
    } as unknown as McpApiClient;
  }

  const baseRegistry = [
    {
      name: 'Stats',
      defaultProps: {
        items: [{ text: '' }],
        columns: '3',
        theme: 'light',
        showSeparator: true,
        verticalMargin: 'none',
      },
    },
  ];

  it('throws with a descriptive error when a component has a hallucinated prop key', async () => {
    const cssApi = makeCssApi(baseRegistry);
    await expect(
      executeTool('create_page', {
        site_id: siteId,
        branch_id: branchId,
        document_path: '/about',
        components: [
          {
            type: 'Stats',
            // 'label' is hallucinated — should be 'text' inside items
            props: { items: [{ label: 'Revenue' }], columns: '3' },
          },
        ],
      }, cssApi, 'user-1'),
    ).rejects.toThrow(/Invalid key\(s\) at "Stats\.props\.items\.0": "label".*Valid keys are:.*text/);
    expect(cssApi.createDocument).not.toHaveBeenCalled();
  });

  it('throws with descriptive error for a top-level hallucinated key', async () => {
    const cssApi = makeCssApi(baseRegistry);
    await expect(
      executeTool('create_page', {
        site_id: siteId,
        branch_id: branchId,
        document_path: '/about',
        components: [
          {
            type: 'Stats',
            props: { items: [{ text: 'Revenue' }], heading: 'Bad key' },
          },
        ],
      }, cssApi, 'user-1'),
    ).rejects.toThrow(/Invalid key\(s\) at "Stats\.props": "heading"/);
    expect(cssApi.createDocument).not.toHaveBeenCalled();
  });

  it('passes when props match defaultProps exactly', async () => {
    const cssApi = makeCssApi(baseRegistry);
    await executeTool('create_page', {
      site_id: siteId,
      branch_id: branchId,
      document_path: '/about',
      components: [
        {
          type: 'Stats',
          props: {
            items: [{ text: 'Revenue' }],
            columns: '3',
            theme: 'light',
            showSeparator: true,
            verticalMargin: 'none',
          },
        },
      ],
    }, cssApi, 'user-1');
    expect(cssApi.createDocument).toHaveBeenCalledOnce();
    expect(cssApi.applyEdits).toHaveBeenCalled();
  });

  it('passes when props are a subset of defaultProps (optional fields omitted)', async () => {
    const cssApi = makeCssApi(baseRegistry);
    await executeTool('create_page', {
      site_id: siteId,
      branch_id: branchId,
      document_path: '/about',
      components: [
        {
          type: 'Stats',
          props: { items: [{ text: 'Revenue' }], columns: '3' },
        },
      ],
    }, cssApi, 'user-1');
    expect(cssApi.createDocument).toHaveBeenCalledOnce();
    expect(cssApi.applyEdits).toHaveBeenCalled();
  });

  it('injects a fresh ULID for each component and sends via applyEdits', async () => {
    const cssApi = makeCssApi(baseRegistry);
    await executeTool('create_page', {
      site_id: siteId,
      branch_id: branchId,
      document_path: '/about',
      components: [
        {
          type: 'Stats',
          // Agent may or may not include id — we always overwrite with a fresh ULID
          props: { items: [{ text: 'Revenue' }], columns: '3', id: 'agent-provided-id' },
        },
      ],
    }, cssApi, 'user-1');
    expect(cssApi.applyEdits).toHaveBeenCalled();
    const applyCall = (cssApi.applyEdits as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      operations: Array<{ type: string; path: string; content: Array<{ props: { id: string } }> }>;
    };
    const op = applyCall.operations[0];
    expect(op.type).toBe('replace');
    expect(op.path).toBe('content');
    const componentId = op.content[0].props.id;
    // Should be a fresh ULID (26 chars, uppercase alphanumeric), not the agent's value
    expect(componentId).not.toBe('agent-provided-id');
    expect(componentId).toMatch(/^[0-9A-Z]{26}$/);
  });

  it('still throws on unknown component type', async () => {
    const cssApi = makeCssApi(baseRegistry);
    await expect(
      executeTool('create_page', {
        site_id: siteId,
        branch_id: branchId,
        document_path: '/about',
        components: [
          { type: 'Nonexistent', props: {} },
        ],
      }, cssApi, 'user-1'),
    ).rejects.toThrow(/Unknown component type\(s\): Nonexistent/);
    expect(cssApi.createDocument).not.toHaveBeenCalled();
  });

  it('returns createResult directly when components array is empty', async () => {
    const cssApi = makeCssApi(baseRegistry);
    const result = await executeTool('create_page', {
      site_id: siteId,
      branch_id: branchId,
      document_path: '/about',
      components: [],
    }, cssApi, 'user-1') as Record<string, unknown>;
    expect(cssApi.createDocument).toHaveBeenCalledOnce();
    expect(cssApi.canAgentEdit).not.toHaveBeenCalled();
    expect(result.documentId).toBe('doc-1');
    expect(result).not.toHaveProperty('components');
  });

  it('returns page with warning when canAgentEdit returns canEdit: false', async () => {
    const cssApi = {
      ...makeCssApi(baseRegistry),
      canAgentEdit: vi.fn().mockResolvedValue({ canEdit: false, reason: 'locked by another user' }),
    } as unknown as McpApiClient;
    (cssApi.listComponents as ReturnType<typeof vi.fn>).mockResolvedValue({ components: baseRegistry });
    (cssApi.createDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ documentId: 'doc-1', documentPath: 'about', versionId: 'v-1' });

    const result = await executeTool('create_page', {
      site_id: siteId,
      branch_id: branchId,
      document_path: '/about',
      components: [{ type: 'Stats', props: { items: [{ text: 'Revenue' }], columns: '3' } }],
    }, cssApi, 'user-1') as Record<string, unknown>;

    expect(cssApi.createDocument).toHaveBeenCalledOnce();
    expect(cssApi.startAgentEdit).not.toHaveBeenCalled();
    expect(result.warning).toMatch(/locked by another user/);
  });

  it('aborts the edit session and rethrows when applyEdits fails', async () => {
    const abortMock = vi.fn().mockResolvedValue({});
    const cssApi = {
      ...makeCssApi(baseRegistry),
      applyEdits: vi.fn().mockRejectedValue(new Error('CRDT write failed')),
      abortAgentEdit: abortMock,
    } as unknown as McpApiClient;
    (cssApi.listComponents as ReturnType<typeof vi.fn>).mockResolvedValue({ components: baseRegistry });
    (cssApi.createDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ documentId: 'doc-1', documentPath: 'about', versionId: 'v-1' });
    (cssApi.canAgentEdit as ReturnType<typeof vi.fn>).mockResolvedValue({ canEdit: true });
    (cssApi.startAgentEdit as ReturnType<typeof vi.fn>).mockResolvedValue({ editSessionId: 'session-1', checkpointId: 'ck-1', expiresAt: '', reservedRegions: [] });

    await expect(
      executeTool('create_page', {
        site_id: siteId,
        branch_id: branchId,
        document_path: '/about',
        components: [{ type: 'Stats', props: { items: [{ text: 'Revenue' }], columns: '3' } }],
      }, cssApi, 'user-1'),
    ).rejects.toThrow('CRDT write failed');

    expect(abortMock).toHaveBeenCalledOnce();
  });

  it('does NOT abort when completeAgentEdit fails after edits are already applied', async () => {
    const abortMock = vi.fn().mockResolvedValue({});
    const cssApi = {
      ...makeCssApi(baseRegistry),
      completeAgentEdit: vi.fn().mockRejectedValue(new Error('complete failed')),
      abortAgentEdit: abortMock,
    } as unknown as McpApiClient;
    (cssApi.listComponents as ReturnType<typeof vi.fn>).mockResolvedValue({ components: baseRegistry });
    (cssApi.createDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ documentId: 'doc-1', documentPath: 'about', versionId: 'v-1' });
    (cssApi.canAgentEdit as ReturnType<typeof vi.fn>).mockResolvedValue({ canEdit: true });
    (cssApi.startAgentEdit as ReturnType<typeof vi.fn>).mockResolvedValue({ editSessionId: 'session-1', checkpointId: 'ck-1', expiresAt: '', reservedRegions: [] });
    (cssApi.applyEdits as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    await expect(
      executeTool('create_page', {
        site_id: siteId,
        branch_id: branchId,
        document_path: '/about',
        components: [{ type: 'Stats', props: { items: [{ text: 'Revenue' }], columns: '3' } }],
      }, cssApi, 'user-1'),
    ).rejects.toThrow('complete failed');

    // Must NOT abort — edits are already in the CRDT
    expect(abortMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// CSS_TOOLS still present and unchanged
// ---------------------------------------------------------------------------

describe('CSS_TOOLS', () => {
  it('still exports list_components, get_document, apply_document_edits etc.', () => {
    const names = CSS_TOOLS.map(t => t.name);
    expect(names).toContain('list_components');
    expect(names).toContain('get_document');
    expect(names).toContain('apply_document_edits');
    expect(names).toContain('complete_edit_session');
    expect(names).toContain('create_page');
  });
});
