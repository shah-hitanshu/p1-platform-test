import type { AttachedFileName, ChatContext } from '../types.js';
import { attachmentNames, attachmentNamesOf, attachmentsOf } from './context.js';
import type { StoredMessage } from './history.js';

/**
 * What counts as the same image. Only an uploaded one has an id; keying the rest by name collapses
 * duplicates that would otherwise read as an ambiguity the user cannot resolve.
 *
 * Shared with the context note, so the list the model is shown and the list the tool searches
 * cannot disagree about which entries are one image.
 */
export function imageKey(image: AttachedFileName): string {
  return image.assetId ?? `name:${image.filename}`;
}

/**
 * Images this conversation can still reach, newest first.
 *
 * Both the turn being answered and earlier turns are read, because the user approves the alt
 * text on a later turn than the one they attached the file to.
 *
 * An image whose upload missed its deadline has no `assetId` and cannot be promoted. It is kept
 * anyway, so the caller can say that rather than claim nothing was attached.
 */
export function conversationImages(
  context: ChatContext,
  history: StoredMessage[],
): AttachedFileName[] {
  const seen = new Set<string>();
  const images: AttachedFileName[] = [];
  const take = (names: AttachedFileName[]): void => {
    for (const name of names) {
      if (name.kind !== 'image') continue;
      const key = imageKey(name);
      if (seen.has(key)) continue;
      seen.add(key);
      images.push(name);
    }
  };

  take(attachmentNames(attachmentsOf(context)));
  for (let i = history.length - 1; i >= 0; i--) {
    take(attachmentNamesOf(history[i].attachments));
  }
  return images;
}

/**
 * Every image carrying the given filename, newest first. All of them rather than the best one:
 * two files can share a name, and picking between them here would add the wrong image under the
 * other one's alt text.
 *
 * Case-insensitive only as a fallback, because the model retypes the name from its own earlier
 * prose — but an exact match wins, or two files differing only in case become indistinguishable.
 */
export function imagesWithFilename(
  filename: string,
  images: AttachedFileName[],
): AttachedFileName[] {
  const wanted = filename.trim();
  if (wanted === '') return [];
  const exact = images.filter(image => image.filename === wanted);
  if (exact.length > 0) return exact;
  const lowered = wanted.toLowerCase();
  return images.filter(image => image.filename.toLowerCase() === lowered);
}

/** An attached image whose upload landed, so unlike {@link AttachedFileName} it has an id. */
export interface UploadedImage {
  filename: string;
  assetId: string;
}

/**
 * The one image a filename identifies, or a refusal saying what to do instead.
 *
 * Guessing between two images of one name is the thing this must not do: it would add the wrong
 * file under the other one's alt text, with nothing to show the user it went wrong.
 */
export function resolveAttachedImage(
  filename: string,
  assetId: unknown,
  images: AttachedFileName[],
): UploadedImage {
  const matches = imagesWithFilename(filename, images);
  if (matches.length === 0) {
    throw new Error(images.length === 0
      ? 'No image has been attached to this conversation, so there is nothing to add.'
      : 'No attached image has that name. Attached images: '
        + `${images.map(image => image.filename).join(', ')}.`);
  }

  const uploaded: UploadedImage[] = matches.flatMap(match =>
    match.assetId === undefined ? [] : [{ filename: match.filename, assetId: match.assetId }]);
  if (uploaded.length === 0) {
    throw new Error(`"${matches[0].filename}" did not finish uploading, so it cannot be added to `
      + 'the library. Ask the user to attach it again.');
  }

  if (typeof assetId === 'string' && assetId !== '') {
    const picked = uploaded.find(image => image.assetId === assetId);
    if (picked === undefined) {
      throw new Error(`No attached image called "${uploaded[0].filename}" has that asset id. `
        + `Use one of: ${uploaded.map(image => image.assetId).join(', ')}.`);
    }
    return picked;
  }

  if (uploaded.length > 1) {
    throw new Error(`${String(uploaded.length)} attached images are called `
      + `"${uploaded[0].filename}". You have seen them, so describe them and ask the user which `
      + `one they mean, then call this again with asset_id set to one of: `
      + `${uploaded.map(image => image.assetId).join(', ')}.`);
  }
  return uploaded[0];
}
