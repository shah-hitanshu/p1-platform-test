import { describe, it, expect } from 'vitest';
import type { Attachment, ChatContext } from '../types.js';
import type { StoredMessage } from './history.js';
import { conversationImages, imagesWithFilename, resolveAttachedImage } from './attached-images.js';

const BASE: ChatContext = {
  siteId: 'site-1',
  branchId: 'branch-1',
  documentPath: 'about',
  token: 'test-token',
};

/** Shaped as the browser sends it, so `parseAttachment` accepts it. */
const attached = (filename: string, assetId?: string): Attachment => ({
  kind: 'image',
  filename,
  dataUrl: 'data:image/png;base64,AAAA',
  ...(assetId === undefined ? {} : { assetId }),
});

/** Shaped as a committed turn stores it: names only, never the file. */
const storedTurn = (attachments: unknown): StoredMessage =>
  ({ role: 'user', content: 'a message', attachments }) as unknown as StoredMessage;

describe('conversationImages', () => {
  it('finds an image attached to the turn being answered', () => {
    const context: ChatContext = { ...BASE, attachments: [attached('hero.png', 'a1')] };

    expect(conversationImages(context, [])).toEqual([
      { kind: 'image', filename: 'hero.png', assetId: 'a1' },
    ]);
  });

  it('finds an image an earlier turn attached', () => {
    const history = [storedTurn([{ kind: 'image', filename: 'hero.png', assetId: 'a1' }])];

    expect(conversationImages(BASE, history)).toEqual([
      { kind: 'image', filename: 'hero.png', assetId: 'a1' },
    ]);
  });

  it('keeps both when two turns attached different files under one name', () => {
    const history = [
      storedTurn([{ kind: 'image', filename: 'logo.png', assetId: 'older' }]),
      storedTurn([{ kind: 'image', filename: 'logo.png', assetId: 'newer' }]),
    ];

    expect(conversationImages(BASE, history).map(i => i.assetId)).toEqual(['newer', 'older']);
  });

  it('lists an image once when the turn and history both carry it', () => {
    const context: ChatContext = { ...BASE, attachments: [attached('hero.png', 'a1')] };
    const history = [storedTurn([{ kind: 'image', filename: 'hero.png', assetId: 'a1' }])];

    expect(conversationImages(context, history)).toHaveLength(1);
  });

  it('keeps an image whose upload never landed', () => {
    const context: ChatContext = { ...BASE, attachments: [attached('hero.png')] };

    expect(conversationImages(context, [])).toEqual([{ kind: 'image', filename: 'hero.png' }]);
  });

  it('collapses repeated unstored entries for one name', () => {
    const context: ChatContext = { ...BASE, attachments: [attached('hero.png')] };
    const history = [storedTurn([{ kind: 'image', filename: 'hero.png' }])];

    expect(conversationImages(context, history)).toHaveLength(1);
  });

  it('keeps two unstored images apart when neither has an id to compare', () => {
    const history = [
      storedTurn([{ kind: 'image', filename: 'first.png' }]),
      storedTurn([{ kind: 'image', filename: 'second.png' }]),
    ];

    // Neither finished uploading, so the name is the only thing telling them apart. Keyed on
    // the missing id alone they collapse, and the user is told about one of the two.
    expect(conversationImages(BASE, history).map(i => i.filename))
      .toEqual(['second.png', 'first.png']);
  });

  it('ignores a document attachment', () => {
    const history = [storedTurn([{ kind: 'document', filename: 'brief.md', assetId: 'd1' }])];

    expect(conversationImages(BASE, history)).toEqual([]);
  });

  it('ignores a malformed history entry rather than throwing', () => {
    const history = [storedTurn('not a list'), storedTurn([null, 42])];

    expect(conversationImages(BASE, history)).toEqual([]);
  });
});

describe('imagesWithFilename', () => {
  const images = [
    { kind: 'image' as const, filename: 'Hero Shot.png', assetId: 'a1' },
    { kind: 'image' as const, filename: 'logo.svg', assetId: 'a2' },
  ];

  it('returns the image a name matches', () => {
    expect(imagesWithFilename('logo.svg', images).map(i => i.assetId)).toEqual(['a2']);
  });

  it('matches a name the model re-cased', () => {
    expect(imagesWithFilename('hero shot.PNG', images).map(i => i.assetId)).toEqual(['a1']);
  });

  it('prefers exact matches over case-insensitive ones', () => {
    const both = [
      { kind: 'image' as const, filename: 'HERO.png', assetId: 'upper' },
      { kind: 'image' as const, filename: 'hero.png', assetId: 'exact' },
    ];

    expect(imagesWithFilename('hero.png', both).map(i => i.assetId)).toEqual(['exact']);
  });

  it('returns every image sharing a name', () => {
    const both = [
      { kind: 'image' as const, filename: 'logo.png', assetId: 'newer' },
      { kind: 'image' as const, filename: 'logo.png', assetId: 'older' },
    ];

    expect(imagesWithFilename('logo.png', both).map(i => i.assetId)).toEqual(['newer', 'older']);
  });

  it('returns nothing for a name that matches nothing', () => {
    expect(imagesWithFilename('missing.png', images)).toEqual([]);
  });

  it('returns nothing for an empty name', () => {
    expect(imagesWithFilename('   ', images)).toEqual([]);
  });
});

describe('resolveAttachedImage', () => {
  const stored = { kind: 'image' as const, filename: 'hero.png', assetId: 'a1' };
  const twin = { kind: 'image' as const, filename: 'hero.png', assetId: 'a2' };
  const unstored = { kind: 'image' as const, filename: 'late.png' };

  it('returns the one image a name identifies', () => {
    expect(resolveAttachedImage('hero.png', undefined, [stored]))
      .toEqual({ filename: 'hero.png', assetId: 'a1' });
  });

  it('says there is nothing to add when nothing was attached', () => {
    expect(() => resolveAttachedImage('hero.png', undefined, []))
      .toThrow('No image has been attached');
  });

  it('lists what is attached when the name matches none of it', () => {
    expect(() => resolveAttachedImage('banner.png', undefined, [stored]))
      .toThrow('Attached images: hero.png');
  });

  it('explains that a visible image was never stored', () => {
    expect(() => resolveAttachedImage('late.png', undefined, [unstored]))
      .toThrow('did not finish uploading');
  });

  it('refuses to pick between two images sharing a name', () => {
    expect(() => resolveAttachedImage('hero.png', undefined, [stored, twin]))
      .toThrow('asset_id');
  });

  it('takes asset_id as the tiebreaker once the user has said which', () => {
    expect(resolveAttachedImage('hero.png', 'a2', [stored, twin]))
      .toEqual({ filename: 'hero.png', assetId: 'a2' });
  });

  it('refuses an asset_id that names none of the matches', () => {
    expect(() => resolveAttachedImage('hero.png', 'nope', [stored, twin]))
      .toThrow('asset id');
  });

  it('ignores a non-string asset_id rather than trusting it', () => {
    expect(resolveAttachedImage('hero.png', 42, [stored]))
      .toEqual({ filename: 'hero.png', assetId: 'a1' });
  });
});
