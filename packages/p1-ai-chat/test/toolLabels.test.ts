import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toolCallLabel, toolCallOutcome, toolCallNote } from '../src/lib/transcript/toolLabels.js';
import type { ToolCallStatus } from '../src/types.js';

const call = (over: Partial<ToolCallStatus> = {}): ToolCallStatus => ({
  name: 'get_document',
  status: 'done',
  ...over,
});

// Several tests below label an unmapped tool, which warns by design. Stubbed so the
// diagnostic doesn't land in the CI log as if it were a fault.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('toolCallLabel', () => {
  it('uses present tense while running and past tense once done', () => {
    expect(toolCallLabel(call({ name: 'complete_edit_session', status: 'running' }))).toBe('Saving changes');
    expect(toolCallLabel(call({ name: 'complete_edit_session', status: 'done' }))).toBe('Saved changes');
  });

  it('appends the page path for document reads, without the leading slash', () => {
    expect(toolCallLabel(call({ name: 'get_document', input: { document_path: '/about' } })))
      .toBe('Read the page · about');
  });

  it('calls the root document "home" rather than showing an empty path', () => {
    expect(toolCallLabel(call({ name: 'get_document', input: { document_path: '/' } })))
      .toBe('Read the page · home');
  });

  it('counts edits from the operations argument', () => {
    expect(toolCallLabel(call({
      name: 'apply_document_edits',
      status: 'running',
      input: { operations: [{}, {}, {}] },
    }))).toBe('Applying changes · 3 edits');
  });

  it('counts the pages listed', () => {
    expect(toolCallLabel(call({
      name: 'list_documents',
      result: { documents: ['about', 'contact-us'] },
    }))).toBe('Checked the pages on this site · 2 pages');
  });

  it('counts the page templates found', () => {
    expect(toolCallLabel(call({
      name: 'list_page_templates',
      result: [{ id: 'a' }, { id: 'b' }],
    }))).toBe('Checked the page templates · 2 templates');
  });

  // Not a failure — the site simply has none — but it is why the reply that follows offers a
  // blank page, so an empty result must say so rather than read like a successful lookup.
  it('says so when a site has no page templates', () => {
    expect(toolCallLabel(call({ name: 'list_page_templates', result: [] })))
      .toBe('Checked the page templates · none available');
  });

  it('falls back to operationsApplied from the result when input has no operations', () => {
    expect(toolCallLabel(call({
      name: 'apply_document_edits',
      input: {},
      result: { success: true, operationsApplied: 1 },
    }))).toBe('Applied changes · 1 edit');
  });

  it('shows only the hostname for fetched URLs', () => {
    expect(toolCallLabel(call({
      name: 'fetch_page',
      input: { url: 'https://example.com/some/very/long/path?q=1' },
    }))).toBe('Fetched the page · example.com');
  });

  it('omits the detail when a URL is unparseable rather than rendering junk', () => {
    expect(toolCallLabel(call({ name: 'fetch_page', input: { url: 'not a url' } })))
      .toBe('Fetched the page');
  });

  it('falls back to the raw tool name for tools with no mapping', () => {
    expect(toolCallLabel(call({ name: 'some_future_tool' }))).toBe('some_future_tool');
  });

  it('tolerates missing, null, and wrongly-typed inputs from the model', () => {
    expect(toolCallLabel(call({ name: 'get_document', input: undefined }))).toBe('Read the page');
    expect(toolCallLabel(call({ name: 'get_document', input: null }))).toBe('Read the page');
    expect(toolCallLabel(call({ name: 'get_document', input: 'nonsense' }))).toBe('Read the page');
    expect(toolCallLabel(call({ name: 'get_document', input: { document_path: 42 } }))).toBe('Read the page');
  });
});

describe('toolCallOutcome', () => {
  it('treats an error field as failure', () => {
    expect(toolCallOutcome(call({ result: { error: 'boom' } }))).toBe('failed');
  });

  it('treats success:false as failure', () => {
    expect(toolCallOutcome(call({ result: { success: false } }))).toBe('failed');
  });

  it('does not flag a successful result', () => {
    expect(toolCallOutcome(call({ result: { success: true, operationsApplied: 2 } }))).toBe('done');
  });

  it('reports a call still in flight as running, whatever a stale result says', () => {
    expect(toolCallOutcome(call({ status: 'running', result: { error: 'boom' } }))).toBe('running');
  });
});

describe('toolCallLabel for failed calls', () => {
  it('says the action failed rather than reporting it as done', () => {
    expect(toolCallLabel(call({ name: 'complete_edit_session', result: { error: 'boom' } })))
      .toBe("Couldn't save changes");
  });

  it('reports a failure for success:false, which carries no error text', () => {
    expect(toolCallLabel(call({ name: 'apply_document_edits', result: { success: false } })))
      .toBe("Couldn't apply changes");
  });

  it('drops the success detail, which would misdescribe the outcome', () => {
    const failed = call({
      name: 'apply_document_edits',
      input: { operations: [1, 2, 3] },
      result: { error: 'Authentication required' },
    });
    // Not "· 3 edits" — nothing was applied.
    expect(toolCallLabel(failed)).toBe("Couldn't apply changes");
  });

  it('keeps the label free of the reason, so the badge stays a single-line pill', () => {
    const label = toolCallLabel(call({ name: 'get_document', result: { error: 'x'.repeat(200) } }));
    expect(label).toBe("Couldn't read the page");
  });

  it('falls back to the raw tool name for an unmapped tool that fails', () => {
    expect(toolCallLabel(call({ name: 'mystery_tool', result: { error: 'nope' } })))
      .toBe('mystery_tool');
  });

  it('keeps the running label even when a stale result is present', () => {
    expect(toolCallLabel(call({ name: 'get_document', status: 'running', result: { error: 'boom' } })))
      .toBe('Reading the page');
  });
});

describe('toolCallNote', () => {
  it('reads the error text from a failed result', () => {
    expect(toolCallNote(call({ result: { error: 'Document not found' } })))
      .toBe('Document not found');
  });

  it('falls back to a message field', () => {
    expect(toolCallNote(call({ result: { message: 'Bad request' } }))).toBe('Bad request');
  });

  it('collapses newlines so a multi-line backend error stays one paragraph', () => {
    expect(toolCallNote(call({ result: { error: 'bad\n\n  request' } }))).toBe('bad request');
  });

  it('caps a runaway payload so a stack trace cannot swamp the transcript', () => {
    const reason = toolCallNote(call({ result: { error: 'x'.repeat(500) } }));
    expect(reason).toHaveLength(200);
    expect(reason?.endsWith('…')).toBe(true);
  });

  it('returns nothing when the failure carries no reason', () => {
    expect(toolCallNote(call({ result: { success: false } }))).toBeUndefined();
    expect(toolCallNote(call({ result: { error: '   ' } }))).toBeUndefined();
    expect(toolCallNote(call({ result: undefined }))).toBeUndefined();
  });
});

describe('toolCallOutcome — result shapes that are not obviously failures', () => {
  /**
   * check_edit_permission returns the CCR response verbatim: a refusal is
   * { canEdit: false, reason } with no `error` and no `success: false`. Without this the row
   * rendered a green check reading "Confirmed edit permission" for a denial, and the reason
   * was never shown at all.
   */
  it('treats a denied edit permission as a denial, which is an answer and not a fault', () => {
    expect(toolCallOutcome(call({
      name: 'check_edit_permission',
      result: { canEdit: false, reason: 'Region reserved by another editor' },
    }))).toBe('denied');
  });

  it('still passes a granted edit permission', () => {
    expect(toolCallOutcome(call({
      name: 'check_edit_permission',
      result: { canEdit: true, conflictingRegions: [] },
    }))).toBe('done');
  });

  /** create_page reports partial success this way: the page exists but has no components. */
  it('calls a warning partial, since the page was in fact created', () => {
    expect(toolCallOutcome(call({
      name: 'create_page',
      result: { documentId: 'd1', warning: 'Page created but could not populate components' },
    }))).toBe('partial');
  });

  it('treats a warning alongside a hard error as an outright failure', () => {
    expect(toolCallOutcome(call({
      name: 'create_page',
      result: { warning: 'partly done', error: 'Permission denied' },
    }))).toBe('failed');
  });

  it('leaves a warning from a tool with no partial contract as an ordinary success', () => {
    // Only create_page defines one. A warning beside a good result elsewhere means the tool
    // did its job, and the row must not imply otherwise.
    expect(toolCallOutcome(call({
      name: 'list_media',
      result: { assets: [{ id: 'a1' }], warning: 'skipped 1 unsupported asset' },
    }))).toBe('done');
  });

  it('does not treat an abandoned call as a failure', () => {
    // The turn ended before the result came back; the call may well have succeeded.
    expect(toolCallOutcome(call({ name: 'apply_document_edits', status: 'abandoned' }))).toBe('abandoned');
  });
});

describe('toolCallLabel for abandoned calls', () => {
  it('keeps the present tense and says it did not finish', () => {
    // Past tense ("Applied changes") would assert a completion we never observed.
    expect(toolCallLabel(call({ name: 'apply_document_edits', status: 'abandoned' })))
      .toBe("Applying changes — didn't finish");
  });
});

describe('a tool the user has not granted the page for', () => {
  // The Worker refuses these before the call reaches the backend and flags the result, so the
  // panel does not have to read the message to tell a refusal from a fault.
  const refused = (name: string) => call({
    name,
    result: { error: '"contact-us" is not in your write set. Ask the user to add the page.', denied: true },
  });

  it('is a denial, not a failure', () => {
    expect(toolCallOutcome(refused('check_edit_permission'))).toBe('denied');
    expect(toolCallOutcome(refused('apply_document_edits'))).toBe('denied');
  });

  // "Couldn't check edit permission" says the check broke, and invites the retry its own reason
  // rules out.
  it('says the page cannot be edited rather than that the check failed', () => {
    expect(toolCallLabel(refused('check_edit_permission'))).toBe("Can't edit this page");
  });

  // The refused page is rarely the one on screen, and "this page" reads as the one the user is
  // looking at.
  it('names the page it was refused for', () => {
    const call_ = { ...refused('check_edit_permission'), input: { document_path: '/contact-us' } };
    expect(toolCallLabel(call_)).toBe("Can't edit this page · contact-us");
  });

  // The page, not the tool's own detail: nothing was applied, so a count of edits would claim
  // work this call did not do.
  it('names the page rather than the work it did not do', () => {
    const call_ = {
      ...refused('apply_document_edits'),
      input: { document_path: 'contact-us', operations: [{}, {}, {}] },
    };
    expect(toolCallLabel(call_)).toBe("Couldn't apply changes · contact-us");
  });

  it('keeps an action tool\'s wording, which a refusal does not make untrue', () => {
    expect(toolCallLabel(refused('apply_document_edits'))).toBe("Couldn't apply changes");
  });

  it('still shows the reason, which names the page and how to grant it', () => {
    expect(toolCallNote(refused('check_edit_permission')))
      .toContain('not in your write set');
  });

  // Otherwise a broken backend reads as a permission the user could grant by adding a page.
  it('leaves a genuine fault a failure', () => {
    const broken = call({ name: 'check_edit_permission', result: { error: 'CSS backend returned 500' } });

    expect(toolCallOutcome(broken)).toBe('failed');
    expect(toolCallLabel(broken)).toBe("Couldn't check edit permission");
  });
});

describe('toolCallLabel for create_page', () => {
  // A template places the page under its route shape, so the requested path is not necessarily
  // where the page is — and this row is where the user reads it.
  it('shows the path the page landed on, not the one asked for', () => {
    expect(toolCallLabel(call({
      name: 'create_page',
      input: { document_path: 'hello-world' },
      result: { documentId: 'd1', documentPath: 'blog/hello-world' },
    }))).toBe('Created the page · blog/hello-world');
  });

  it('falls back to the requested path while the call is still in flight', () => {
    expect(toolCallLabel(call({
      name: 'create_page',
      status: 'running',
      input: { document_path: 'hello-world' },
    }))).toBe('Creating the page · hello-world');
  });
});

describe('toolCallLabel for partial calls', () => {
  it('says the page was created, since it was, and names what is missing', () => {
    // Not "Couldn't create the page": the page exists, and telling the user it does not
    // sends them to create a second one.
    expect(toolCallLabel(call({
      name: 'create_page',
      result: { documentId: 'd1', warning: 'Page created but could not populate components' },
    }))).toBe('Created the page, without its components');
  });

  it('surfaces the warning as the row note', () => {
    expect(toolCallNote(call({
      name: 'create_page',
      result: { warning: 'Page created but could not populate components' },
    }))).toBe('Page created but could not populate components');
  });
});

describe('toolCallLabel for an unmapped tool', () => {
  it('keeps the "didn\'t finish" qualifier, which the raw name alone does not carry', () => {
    // Without it an abandoned call reads exactly like one that completed.
    expect(toolCallLabel(call({ name: 'some_future_tool', status: 'abandoned' })))
      .toBe("some_future_tool — didn't finish");
  });
});

describe('unmapped tool diagnostics', () => {
  it('warns once per unmapped tool, without putting its name in the format string', () => {
    const warn = vi.mocked(console.warn);

    toolCallLabel(call({ name: 'brand_new_tool' }));
    toolCallLabel(call({ name: 'brand_new_tool' }));

    // Once: toolCallLabel runs on every render, so warning per call would bury the console.
    expect(warn).toHaveBeenCalledTimes(1);
    // The name arrives over the wire, so it is an argument rather than interpolated text.
    expect(warn.mock.calls[0]?.[0]).not.toContain('brand_new_tool');
    expect(warn.mock.calls[0]?.[1]).toBe('brand_new_tool');
  });
});
