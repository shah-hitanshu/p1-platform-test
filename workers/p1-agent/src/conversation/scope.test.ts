import { describe, it, expect } from 'vitest';
import type { ChatContext } from '../types.js';
import {
  assertWritable,
  createdDocumentPath,
  isWriteSetScoped,
  isWriteTool,
  normalizeDocumentPath,
  withCreatedPage,
  writableDocuments,
} from './scope.js';

const base: ChatContext = {
  siteId: 'site-1',
  branchId: 'branch-1',
  documentPath: 'about',
  token: 'token',
};

// `create_page` is absent on purpose — see the "creating a page" block below.
const WRITE_TOOLS = [
  'check_edit_permission',
  'start_edit_session',
  'apply_document_edits',
  'complete_edit_session',
  'abort_edit_session',
];

const READ_TOOLS = [
  'get_document',
  'list_documents',
  'list_components',
  'list_page_templates',
  'get_branch_presence',
  'get_document_presence',
  'list_media',
  'fetch_page',
];

/** A write call aimed at `path`, in the site the session is working in. */
function writeAt(path: string): Record<string, unknown> {
  return { site_id: 'site-1', branch_id: 'branch-1', document_path: path };
}

// Each case is one the CCR backend resolves to the same document, so the write set has to as
// well — otherwise a granted page refuses a write aimed at it under another spelling.
describe('normalizeDocumentPath', () => {
  it.each([
    ['/about', 'about'],
    ['about', 'about'],
    ['About', 'about'],
    ['ABOUT/', 'about'],
    ['about/', 'about'],
    ['//about', 'about'],
    ['blog//hello', 'blog/hello'],
    ['blog\\hello', 'blog/hello'],
    ['  /About/  ', 'about'],
    ['blog/hello', 'blog/hello'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeDocumentPath(input)).toBe(expected);
  });

  it('keeps the home page as "/"', () => {
    expect(normalizeDocumentPath('/')).toBe('/');
  });

  it('leaves an empty path empty, which means no document is open', () => {
    expect(normalizeDocumentPath('')).toBe('');
  });
});

describe('writableDocuments', () => {
  it('normalizes the declared set', () => {
    const context = { ...base, writeSet: ['/about', 'blog/hello'] };
    expect(writableDocuments(context)).toEqual(['about', 'blog/hello']);
  });

  it('collapses paths that differ only by a leading slash', () => {
    const context = { ...base, writeSet: ['/about', 'about'] };
    expect(writableDocuments(context)).toEqual(['about']);
  });

  it('keeps the home page', () => {
    const context = { ...base, writeSet: ['/'] };
    expect(writableDocuments(context)).toEqual(['/']);
  });

  it('drops empty paths, which a client sends for "no document open"', () => {
    const context = { ...base, documentPath: '', writeSet: ['', 'about'] };
    expect(writableDocuments(context)).toEqual(['about']);
  });

  it('falls back to the open document when the client sent no write set', () => {
    expect(writableDocuments({ ...base, documentPath: '/index' })).toEqual(['index']);
  });

  it('grants a page created during the turn, which the client cannot add until the next one', () => {
    const context = { ...base, writeSet: ['about'] };
    expect(writableDocuments(withCreatedPage(context, '/pricing'))).toEqual(['about', 'pricing']);
  });
});

describe('assertWritable', () => {
  const context: ChatContext = { ...base, writeSet: ['about', 'blog/hello'] };

  it.each(READ_TOOLS)('lets %s read a page outside the write set', tool => {
    expect(() => assertWritable(tool, writeAt('somewhere-else'), context)).not.toThrow();
  });

  it.each(WRITE_TOOLS)('refuses %s for a page outside the write set', tool => {
    expect(() => assertWritable(tool, writeAt('somewhere-else'), context))
      .toThrow('not in your write set');
  });

  it.each(WRITE_TOOLS)('allows %s for a page inside the write set', tool => {
    expect(() => assertWritable(tool, writeAt('blog/hello'), context)).not.toThrow();
  });

  it.each(['/about', 'About', 'about/', '//about', '  about  '])(
    'matches the granted page written as %s',
    spelling => {
      expect(() => assertWritable('apply_document_edits', writeAt(spelling), context)).not.toThrow();
    },
  );

  it('refuses a write aimed at another branch of an allowed path', () => {
    const input = { ...writeAt('about'), branch_id: 'some-other-branch' };
    expect(() => assertWritable('apply_document_edits', input, context)).toThrow('Not your branch');
  });

  it('falls back to the open document when writeSet arrives malformed', () => {
    const malformed = { ...base, writeSet: 'about' as unknown as string[] };
    expect(() => assertWritable('apply_document_edits', writeAt('about'), malformed)).not.toThrow();
    expect(() => assertWritable('apply_document_edits', writeAt('elsewhere'), malformed))
      .toThrow('not in your write set');
  });

  it('refuses a write to another site even when the path is in the set', () => {
    const input = { ...writeAt('about'), site_id: 'site-2' };
    expect(() => assertWritable('apply_document_edits', input, context)).toThrow('Not your site');
  });

  it('holds a client too old to send a write set to its open document', () => {
    const legacy: ChatContext = { ...base, documentPath: 'about' };
    expect(() => assertWritable('apply_document_edits', writeAt('about'), legacy)).not.toThrow();
    expect(() => assertWritable('apply_document_edits', writeAt('blog/hello'), legacy))
      .toThrow('not in your write set');
  });

  describe('creating a page', () => {
    it('is allowed anywhere on the site, write set or not', () => {
      expect(() => assertWritable('create_page', writeAt('somewhere-new'), context)).not.toThrow();
    });

    it('is still confined to the session\'s site', () => {
      const input = { ...writeAt('somewhere-new'), site_id: 'site-2' };
      expect(() => assertWritable('create_page', input, context)).toThrow('Not your site');
    });

    it('leaves the new page editable for the rest of the turn', () => {
      const after = withCreatedPage(context, 'somewhere-new');
      expect(() => assertWritable('apply_document_edits', writeAt('somewhere-new'), after))
        .not.toThrow();
    });

    // The backend normalizes on the way in, so a grant taken from the request would not match
    // the edits that follow, and the new page would be left empty.
    it('grants the path the backend reports, not the one the model asked for', () => {
      expect(createdDocumentPath({ documentId: 'd1', documentPath: 'pricing' })).toBe('pricing');
      const after = withCreatedPage(context, 'pricing');
      expect(() => assertWritable('apply_document_edits', writeAt('/Pricing'), after)).not.toThrow();
    });

    it('grants nothing when the result carries no path', () => {
      expect(createdDocumentPath({ error: 'already exists' })).toBeNull();
      expect(createdDocumentPath(null)).toBeNull();
    });

    // Creating one page must not quietly widen the set to everything.
    it('grants only the page it created', () => {
      const after = withCreatedPage(context, 'somewhere-new');
      expect(() => assertWritable('apply_document_edits', writeAt('another-page'), after))
        .toThrow('not in your write set');
    });
  });

  it('tells the model what it may edit and not to retry', () => {
    expect(() => assertWritable('apply_document_edits', writeAt('secret'), context))
      .toThrow(/You may edit: about, blog\/hello\..*do not retry/s);
  });

  // Also shown in the transcript as the step's failure note, which the panel truncates at 200
  // characters (`MAX_NOTE_LENGTH` in toolLabels.ts) — past that the instruction is cut in half.
  it('stays short enough to survive the panel\'s note cap', () => {
    expect(() => assertWritable('apply_document_edits', writeAt('secret'), context))
      .toThrow(/^.{1,200}$/s);
  });

  it('names no page rather than claiming an empty set is permissive', () => {
    const empty: ChatContext = { ...base, documentPath: '', writeSet: [] };
    expect(() => assertWritable('apply_document_edits', writeAt('about'), empty))
      .toThrow('nothing on this site');
  });
});

describe('classifying tools', () => {
  it.each(WRITE_TOOLS)('%s writes, and is held to the write set', tool => {
    expect(isWriteTool(tool)).toBe(true);
    expect(isWriteSetScoped(tool)).toBe(true);
  });

  it.each(READ_TOOLS)('%s neither writes nor is scoped', tool => {
    expect(isWriteTool(tool)).toBe(false);
    expect(isWriteSetScoped(tool)).toBe(false);
  });

  it('create_page writes, but is not held to the write set', () => {
    expect(isWriteTool('create_page')).toBe(true);
    expect(isWriteSetScoped('create_page')).toBe(false);
  });
});
