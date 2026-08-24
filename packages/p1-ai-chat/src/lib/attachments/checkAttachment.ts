import {
  DOCUMENT_EXTENSIONS,
  IMAGE_TYPES,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  RICH_DOCUMENT_EXTENSIONS,
  hasExtension,
  type FileFacts,
} from './fileRules.js';

export type FileVerdict =
  | { kind: 'document' }
  | { kind: 'image' }
  /** `reason` is shown to the user as written. */
  | { kind: 'rejected'; reason: string };

export function checkAttachment(file: FileFacts): FileVerdict {
  if (IMAGE_TYPES.has(file.type)) {
    return file.size > MAX_IMAGE_BYTES
      ? { kind: 'rejected', reason: 'This image is over the 10 MB limit.' }
      : { kind: 'image' };
  }
  if (file.type === 'image/svg+xml' || hasExtension(file.name, ['.svg'])) {
    return { kind: 'rejected', reason: 'SVG files are not accepted. Use a PNG, JPEG, GIF, WebP or AVIF.' };
  }
  if (hasExtension(file.name, RICH_DOCUMENT_EXTENSIONS)) {
    return {
      kind: 'rejected',
      reason: 'PDF and Word files cannot be read yet. Export it as .md or .txt, or paste the text in.',
    };
  }
  if (file.type.startsWith('text/') || hasExtension(file.name, DOCUMENT_EXTENSIONS)) {
    return file.size > MAX_DOCUMENT_BYTES
      ? { kind: 'rejected', reason: 'This brief is over the 512 KB limit.' }
      : { kind: 'document' };
  }
  return { kind: 'rejected', reason: 'This kind of file cannot be used. Attach a text brief or an image.' };
}
