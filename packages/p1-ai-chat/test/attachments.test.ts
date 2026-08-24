import { describe, it, expect } from 'vitest';
import { AttachmentError } from '../src/lib/attachments/attachmentError.js';
import { truncateBrief } from '../src/lib/attachments/briefText.js';
import { checkAttachment } from '../src/lib/attachments/checkAttachment.js';
import { clipboardFiles } from '../src/lib/attachments/clipboardFiles.js';
import { ACCEPTED_FILE_TYPES, MAX_BRIEF_CHARS, MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, isHtmlFile } from '../src/lib/attachments/fileRules.js';
import { attachmentBlocker, readyAttachments } from '../src/lib/attachments/pendingAttachments.js';
import type { PendingAttachment } from '../src/types.js';

const file = (over: Partial<{ name: string; type: string; size: number }> = {}) => ({
  name: 'brief.md',
  type: 'text/markdown',
  size: 1_000,
  ...over,
});

const attachment = (over: Partial<PendingAttachment> = {}): PendingAttachment => ({
  id: 'a1',
  kind: 'document',
  filename: 'brief.md',
  status: 'ready',
  text: 'the brief',
  ...over,
});

describe('AttachmentError', () => {
  it('carries its own name, so a log line does not just say "Error"', () => {
    const error = new AttachmentError('This file has no text in it.');
    expect(error.name).toBe('AttachmentError');
    expect(String(error)).toBe('AttachmentError: This file has no text in it.');
    expect(error).toBeInstanceOf(AttachmentError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('checkAttachment', () => {
  it('takes an image the media library accepts', () => {
    expect(checkAttachment(file({ name: 'hero.png', type: 'image/png' }))).toEqual({ kind: 'image' });
  });

  it('takes text by its type, and by its extension when the browser reports none', () => {
    expect(checkAttachment(file({ name: 'notes.txt', type: 'text/plain' }))).toEqual({ kind: 'document' });
    expect(checkAttachment(file({ name: 'brief.md', type: '' }))).toEqual({ kind: 'document' });
  });

  it('takes an HTML page as a brief', () => {
    expect(checkAttachment(file({ name: 'notes.html', type: 'text/html' }))).toEqual({ kind: 'document' });
    expect(checkAttachment(file({ name: 'notes.htm', type: '' }))).toEqual({ kind: 'document' });
  });

  // The picker has to offer what `checkAttachment` accepts, or "browse" hides a supported format.
  it('offers every accepted format in the file picker', () => {
    for (const accepted of ['.md', '.txt', '.csv', '.html', '.htm', 'image/png', 'image/webp']) {
      expect(ACCEPTED_FILE_TYPES).toContain(accepted);
    }
  });

  it('turns down PDF and Word, and says what to do instead', () => {
    const verdict = checkAttachment(file({ name: 'brief.pdf', type: 'application/pdf' }));

    expect(verdict.kind).toBe('rejected');
    expect(verdict).toHaveProperty('reason', expect.stringContaining('.md'));
    expect(verdict).toHaveProperty('reason', expect.stringContaining('paste'));
  });

  it('turns down SVG', () => {
    expect(checkAttachment(file({ name: 'logo.svg', type: 'image/svg+xml' })).kind).toBe('rejected');
    expect(checkAttachment(file({ name: 'logo.svg', type: '' })).kind).toBe('rejected');
  });

  it('turns down a file of a kind it cannot use at all', () => {
    expect(checkAttachment(file({ name: 'archive.zip', type: 'application/zip' })).kind).toBe('rejected');
  });

  it('turns down an image over the library limit, and a brief over its own', () => {
    expect(
      checkAttachment(file({ name: 'hero.png', type: 'image/png', size: MAX_IMAGE_BYTES + 1 })).kind,
    ).toBe('rejected');
    expect(checkAttachment(file({ size: MAX_DOCUMENT_BYTES + 1 })).kind).toBe('rejected');
    // The limits themselves are boundaries, not refusals.
    expect(checkAttachment(file({ name: 'hero.png', type: 'image/png', size: MAX_IMAGE_BYTES })).kind)
      .toBe('image');
    expect(checkAttachment(file({ size: MAX_DOCUMENT_BYTES })).kind).toBe('document');
  });
});

describe('truncateBrief', () => {
  it('leaves a brief that fits alone', () => {
    expect(truncateBrief('short')).toEqual({ text: 'short', truncated: false });
  });

  it('cuts one that does not, and says so', () => {
    const result = truncateBrief('x'.repeat(MAX_BRIEF_CHARS + 10));

    expect(result.text).toHaveLength(MAX_BRIEF_CHARS);
    expect(result.truncated).toBe(true);
  });
});

describe('clipboardFiles', () => {
  it('names an unnamed paste after its type', () => {
    const pasted = clipboardFiles({ files: [new File(['b'], '', { type: 'image/png' })] });

    expect(pasted.map(f => f.name)).toEqual(['pasted-image.png']);
    expect(pasted[0]?.type).toBe('image/png');
  });

  it('numbers the rest when several arrive together', () => {
    const pasted = clipboardFiles({
      files: [
        new File(['b'], '', { type: 'image/png' }),
        new File(['b'], '', { type: 'image/jpeg' }),
      ],
    });

    expect(pasted.map(f => f.name)).toEqual(['pasted-image.png', 'pasted-image-2.jpg']);
  });

  it('leaves a file that came with a name alone', () => {
    const named = new File(['b'], 'diagram.png', { type: 'image/png' });

    expect(clipboardFiles({ files: [named] })[0]).toBe(named);
  });

  it('finds nothing on a clipboard carrying only text', () => {
    expect(clipboardFiles({ files: [] })).toEqual([]);
    expect(clipboardFiles(null)).toEqual([]);
  });
});

describe('readyAttachments', () => {
  it('carries only what has finished', () => {
    expect(readyAttachments([
      attachment({ id: 'a1' }),
      attachment({ id: 'a2', status: 'pending', text: undefined }),
      attachment({ id: 'a3', status: 'error', error: 'no', text: undefined }),
      attachment({ id: 'a4', kind: 'image', filename: 'hero.png', text: undefined, dataUrl: 'data:image/webp;base64,AAA' }),
    ])).toEqual([
      { kind: 'document', filename: 'brief.md', text: 'the brief' },
      { kind: 'image', filename: 'hero.png', dataUrl: 'data:image/webp;base64,AAA' },
    ]);
  });

  // 'ready' without the payload it is ready for would otherwise send `text: undefined`.
  it('drops an entry whose payload is missing', () => {
    expect(readyAttachments([attachment({ text: undefined })])).toEqual([]);
  });
});

describe('attachmentBlocker', () => {
  it('holds the turn while a file is still arriving', () => {
    expect(attachmentBlocker([attachment({ status: 'pending' })])).toContain('brief.md');
  });

  it('holds the turn until a refused file is dismissed', () => {
    expect(attachmentBlocker([attachment({ status: 'error', error: 'no' })])).toContain('brief.md');
  });

  it('lets a turn go when every file has landed', () => {
    expect(attachmentBlocker([attachment()])).toBeNull();
    expect(attachmentBlocker([])).toBeNull();
  });
});

describe('isHtmlFile', () => {
  it('recognizes a page by type or by extension', () => {
    expect(isHtmlFile({ name: 'page.html', type: 'text/html', size: 1 })).toBe(true);
    expect(isHtmlFile({ name: 'page.htm', type: '', size: 1 })).toBe(true);
    expect(isHtmlFile({ name: 'export', type: 'text/html', size: 1 })).toBe(true);
  });

  it('leaves other briefs to be read as they are', () => {
    expect(isHtmlFile({ name: 'brief.md', type: 'text/markdown', size: 1 })).toBe(false);
    expect(isHtmlFile({ name: 'notes.txt', type: 'text/plain', size: 1 })).toBe(false);
  });
});
