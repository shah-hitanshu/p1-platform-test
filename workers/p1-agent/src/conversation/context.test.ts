import { describe, it, expect } from 'vitest';
import type { Attachment, ChatContext } from '../types.js';
import { attachmentsOf, readAttachments } from './context.js';

describe('attachmentsOf', () => {
  const PNG = 'data:image/png;base64,QUJD';

  const context = (attachments: unknown): ChatContext => ({
    siteId: 's1', branchId: 'b1', documentPath: '/pricing', token: 't',
    attachments: attachments as Attachment[],
  });

  it('takes a document and an image the browser sent', () => {
    expect(attachmentsOf(context([
      { kind: 'document', filename: 'brief.md', text: 'a brief' },
      { kind: 'image', filename: 'hero.png', dataUrl: PNG },
    ]))).toEqual([
      { kind: 'document', filename: 'brief.md', text: 'a brief' },
      { kind: 'image', filename: 'hero.png', dataUrl: PNG },
    ]);
  });

  // The `kind` says which payload to expect; it is not evidence the payload is there.
  it('drops an entry whose payload does not match its kind', () => {
    expect(attachmentsOf(context([
      { kind: 'document', filename: 'brief.md', dataUrl: PNG },
      { kind: 'image', filename: 'hero.png', text: 'not an image' },
      { kind: 'document', filename: 'empty.md', text: '   ' },
      { kind: 'video', filename: 'clip.mp4', dataUrl: PNG },
    ]))).toEqual([]);
  });

  // Copied straight into the provider request, so what it may contain is checked.
  it('keeps only a base64 image data URI', () => {
    const rejected = [
      'data:text/html;base64,PHNjcmlwdD4=',            // not an image
      'data:image/svg+xml;base64,PHN2Zz4=',            // an image type we do not send
      'data:image/png,QUJD',                           // not base64
      'data:image/png;base64,QUJD?x=1',                // trailing junk outside the payload
      'data:image/png;base64,QUJ',                     // not a whole base64 quantum
      'data:image/png;base64,',                        // no payload at all
      'https://media.test/hero.png',                   // a link, which the gateway refuses
      'javascript:alert(1)',
      '',
    ];

    for (const dataUrl of rejected) {
      expect(attachmentsOf(context([{ kind: 'image', filename: 'hero.png', dataUrl }]))).toEqual([]);
    }
    for (const dataUrl of [PNG, 'data:image/webp;base64,QUJD', 'data:image/jpeg;base64,QUJDRA==']) {
      expect(attachmentsOf(context([{ kind: 'image', filename: 'h.png', dataUrl }]))).toHaveLength(1);
    }
  });

  // The backstop against a client that does not shrink.
  it('drops an image far larger than a shrunk one could be', () => {
    const huge = `data:image/png;base64,${'A'.repeat(9 * 1024 * 1024)}`;

    expect(attachmentsOf(context([{ kind: 'image', filename: 'hero.png', dataUrl: huge }]))).toEqual([]);
  });

  it('drops an entry with no usable filename', () => {
    expect(attachmentsOf(context([
      { kind: 'document', filename: '  ', text: 'a brief' },
      { kind: 'document', filename: 'x'.repeat(201), text: 'a brief' },
      { kind: 'document', text: 'a brief' },
    ]))).toEqual([]);
  });

  // The panel truncates too, but nothing stops a client sending whatever it likes.
  it('cuts a brief that would take the turn over, and marks where it stops', () => {
    const [attachment] = attachmentsOf(context([
      { kind: 'document', filename: 'brief.md', text: 'x'.repeat(25_000) },
    ]));

    expect(attachment).toBeDefined();
    if (attachment?.kind !== 'document') throw new Error('expected a document');
    expect(attachment.text).toHaveLength(20_000 + '\n\n[…the rest of this file was not included]'.length);
    expect(attachment.text).toContain('the rest of this file was not included');
  });

  it('reports nothing dropped when a turn carries no files at all', () => {
    expect(readAttachments(context([]))).toEqual({ attachments: [], invalid: 0, overLimit: 0 });
    expect(readAttachments(context(undefined))).toEqual({ attachments: [], invalid: 0, overLimit: 0 });
  });

  it('tells a malformed file apart from one that simply arrived past the cap', () => {
    const withBad = readAttachments(context([
      { kind: 'document', filename: 'brief.md', text: 'real' },
      { kind: 'image', filename: 'hero.png', dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' },
    ]));
    expect(withBad.attachments).toHaveLength(1);
    expect(withBad.invalid).toBe(1);
    expect(withBad.overLimit).toBe(0);

    // Six good files is not six broken ones, and the log says so.
    const tooMany = readAttachments(context(Array.from({ length: 6 }, (_, i) => ({
      kind: 'document', filename: `brief-${String(i)}.md`, text: 'a brief',
    }))));
    expect(tooMany.attachments).toHaveLength(4);
    expect(tooMany.invalid).toBe(0);
    expect(tooMany.overLimit).toBe(2);
  });

  it('turns down AVIF, which the Anthropic transport cannot carry', () => {
    // Accepting it here would put the file in the prompt as seen while the request went without it.
    const avif = readAttachments(context([
      { kind: 'image', filename: 'hero.avif', dataUrl: 'data:image/avif;base64,AAAA' },
    ]));
    expect(avif.attachments).toHaveLength(0);
    expect(avif.invalid).toBe(1);
  });

  it('takes no more than four files, whatever arrives', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      kind: 'document', filename: `brief-${String(i)}.md`, text: 'a brief',
    }));

    expect(attachmentsOf(context(many))).toHaveLength(4);
  });

  it('reads nothing from a turn that carried no files, or a malformed field', () => {
    expect(attachmentsOf(context(undefined))).toEqual([]);
    expect(attachmentsOf(context('brief.md'))).toEqual([]);
    expect(attachmentsOf(context([null, 'x', 42]))).toEqual([]);
  });
});
