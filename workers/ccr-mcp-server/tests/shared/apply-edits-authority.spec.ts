/**
 * Authority warnings on apply_document_edits.
 *
 * Editing a prop a translation inherits from its canonical is reported alongside a
 * successful apply, never in place of it: the reconcile workflow writes exactly
 * those props, so the edits go through and the warning tells the agent which props
 * it does not own. A document that is not a translation, or an authority lookup
 * that fails, leaves the result untouched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const defaultConfig = {
  baseUrl: 'http://localhost:8787',
  agentId: 'agent-1',
  agentApiKey: 'aak_test',
};

const TRANSLATION_ID = 'doc-fr';

const snapshot = {
  content: [
    { type: 'Hero', props: { id: 'Hero-1', title: 'Hello', subtitle: 'Hi' } },
    { type: 'Body', props: { id: 'Body-1', content: 'Words' } },
  ],
  root: { props: {} },
  zones: {},
};

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data) } as Response;
}

/**
 * Routes each request the handler makes by URL. `authority` supplies the
 * authority-overrides response, or an error when the lookup should fail.
 */
function routeFetch(
  authority: { body: unknown; ok?: boolean; status?: number } | 'reject',
): void {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/authority-overrides')) {
      if (authority === 'reject') {
        return Promise.reject(new Error('network down'));
      }
      return Promise.resolve(
        jsonResponse(authority.body, authority.ok ?? true, authority.status ?? 200),
      );
    }
    if (url.includes('/documents/by-path/')) {
      return Promise.resolve(jsonResponse({ id: TRANSLATION_ID, path: 'home', createdAt: '' }));
    }
    if (url.endsWith('/edits')) {
      return Promise.resolve(jsonResponse({ success: true, version: 7 }));
    }
    // Document snapshot read.
    return Promise.resolve(jsonResponse({ snapshot, version: 6 }));
  });
}

async function applyTitleEdit(): Promise<{ isError?: boolean; text: string }> {
  const { McpApiClient } = await import('../../src/shared/api-client.js');
  const { createToolHandlers } = await import('../../src/shared/tools.js');
  const handlers = createToolHandlers(new McpApiClient(defaultConfig));

  const result = await handlers.apply_document_edits({
    site_id: 'site-1',
    branch_id: 'branch-1',
    document_path: 'home',
    edit_session_id: 'session-1',
    operations: [{ type: 'replace', path: 'content.0.props.title', content: 'Bonjour' }],
  });

  return { isError: result.isError, text: result.content[0].text };
}

describe('apply_document_edits authority warnings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('warns about an inherited prop while still applying the edits', async () => {
    routeFetch({
      body: {
        authorityOverrides: {},
        slotDefaults: { 'Hero-1': 'canonical' },
        defaultAuthority: 'canonical',
      },
    });

    const { isError, text } = await applyTitleEdit();

    expect(isError).toBeFalsy();
    expect(text).toContain('Edits applied');
    expect(text).toContain('Hero-1');
    expect(text).toContain('title');
  });

  it('reports nothing when the edited prop is owned by the translation', async () => {
    routeFetch({
      body: {
        authorityOverrides: {},
        slotDefaults: { 'Hero-1': 'locale' },
        defaultAuthority: 'canonical',
      },
    });

    const { isError, text } = await applyTitleEdit();

    expect(isError).toBeFalsy();
    expect(text).not.toContain('Hero-1');
  });

  it('honours a per-prop override that gives the translation the prop', async () => {
    routeFetch({
      body: {
        authorityOverrides: { 'Hero-1': { title: 'locale' } },
        slotDefaults: { 'Hero-1': 'canonical' },
        defaultAuthority: 'canonical',
      },
    });

    const { text } = await applyTitleEdit();

    expect(text).not.toContain('Hero-1');
  });

  it('applies without warnings when the document is not a translation', async () => {
    routeFetch({ body: { error: 'Document is not a translation' }, ok: false, status: 404 });

    const { isError, text } = await applyTitleEdit();

    expect(isError).toBeFalsy();
    expect(text).toContain('Edits applied');
    expect(text).not.toContain('Hero-1');
  });

  it('applies without warnings when the authority lookup fails', async () => {
    routeFetch('reject');

    const { isError, text } = await applyTitleEdit();

    expect(isError).toBeFalsy();
    expect(text).toContain('Edits applied');
  });

  it('still applies the edits when a warning is raised', async () => {
    routeFetch({
      body: {
        authorityOverrides: {},
        slotDefaults: { 'Hero-1': 'canonical' },
        defaultAuthority: 'canonical',
      },
    });

    await applyTitleEdit();

    const editCall = mockFetch.mock.calls.find(([url]) => String(url).endsWith('/edits'));
    expect(editCall).toBeDefined();
  });
});
