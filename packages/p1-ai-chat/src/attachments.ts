import type { AttachedFile, Attachment, PendingAttachment } from './types.js';

// What the composer accepts, and what it says about a file it turns down.

// SVG is left out deliberately: it is a document rather than a bitmap, can carry script, and
// taints a canvas.
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

/** Browsers report no `type` at all for `.md`, so the extension has to be consulted too. */
const DOCUMENT_EXTENSIONS = ['.md', '.markdown', '.txt', '.text', '.csv', '.html', '.htm'];

const HTML_EXTENSIONS = ['.html', '.htm'];

const RICH_DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.rtf', '.odt', '.pages'];

export const MAX_ATTACHMENTS = 4;

/** Read before decoding: a huge original costs memory to decode, however small it ends up. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const MAX_DOCUMENT_BYTES = 512 * 1024;

/** The Worker truncates too; this cap exists so the panel can say the brief was shortened. */
export const MAX_BRIEF_CHARS = 20_000;

export const ACCEPTED_FILE_TYPES = [...IMAGE_TYPES, ...DOCUMENT_EXTENSIONS].join(',');

/**
 * A failure whose message was written to be read by the user. Anything else thrown while a file
 * is taken on is a platform message ("The operation is insecure"), which is replaced, not shown.
 */
export class AttachmentError extends Error {
  override name = 'AttachmentError';

  constructor(message: string) {
    super(message);
    // Needed only if a consumer downlevels this class to ES5, where `instanceof` would break.
    Object.setPrototypeOf(this, AttachmentError.prototype);
  }
}

export const NO_IMAGE_DECODER = 'Images cannot be attached here.';

/** The parts of a `File` the rules read. Named separately so tests need no `File` constructor. */
export interface FileFacts {
  name: string;
  type: string;
  size: number;
}

export type FileVerdict =
  | { kind: 'document' }
  | { kind: 'image' }
  /** `reason` is shown to the user as written. */
  | { kind: 'rejected'; reason: string };

function hasExtension(name: string, extensions: string[]): boolean {
  const lower = name.toLowerCase();
  return extensions.some(extension => lower.endsWith(extension));
}

/** Whether a brief is a web page, whose markup has to come off before the agent reads it. */
export function isHtmlFile(file: FileFacts): boolean {
  return file.type === 'text/html' || hasExtension(file.name, HTML_EXTENSIONS);
}

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

const PASTED_IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/**
 * The files on the clipboard, each with a name — a pasted screenshot often arrives without one,
 * and the name is what the card shows and what the agent is told the image is called.
 *
 * Reads `files` rather than `items`: copying part of a web page puts an HTML flavour on the
 * clipboard with no file, and only `files` tells that apart from pasting an image.
 */
export function clipboardFiles(data: { files?: ArrayLike<File> | null } | null): File[] {
  return Array.from(data?.files ?? []).map((file, index) =>
    file.name === '' ? nameForPaste(file, index) : file,
  );
}

function nameForPaste(file: File, index: number): File {
  const extension = PASTED_IMAGE_EXTENSIONS[file.type] ?? 'bin';
  const suffix = index === 0 ? '' : `-${String(index + 1)}`;
  return new File([file], `pasted-image${suffix}.${extension}`, { type: file.type });
}

export function truncateBrief(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_BRIEF_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_BRIEF_CHARS), truncated: true };
}

/**
 * The attachments that can travel with a turn, in the shape the agent receives. Pending and
 * failed entries are left behind; {@link attachmentBlocker} is what stops that losing one.
 */
export function readyAttachments(attachments: PendingAttachment[]): Attachment[] {
  const ready: Attachment[] = [];
  for (const attachment of attachments) {
    if (attachment.status !== 'ready') continue;
    if (attachment.kind === 'document' && attachment.text !== undefined) {
      ready.push({ kind: 'document', filename: attachment.filename, text: attachment.text });
    } else if (attachment.kind === 'image' && attachment.dataUrl !== undefined) {
      ready.push({ kind: 'image', filename: attachment.filename, dataUrl: attachment.dataUrl });
    }
  }
  return ready;
}

/** A file on the composer in the shape the preview and the transcript take. */
export function toAttachedFile(attachment: PendingAttachment): AttachedFile {
  return {
    kind: attachment.kind,
    filename: attachment.filename,
    ...(attachment.dataUrl !== undefined ? { dataUrl: attachment.dataUrl } : {}),
    ...(attachment.text !== undefined ? { text: attachment.text } : {}),
  };
}

/** Why the composer will not send yet, or null when it will. */
export function attachmentBlocker(attachments: PendingAttachment[]): string | null {
  const pending = attachments.find(a => a.status === 'pending');
  if (pending) return `Waiting for ${pending.filename}`;
  const failed = attachments.find(a => a.status === 'error');
  if (failed) return `Remove ${failed.filename} to send`;
  return null;
}
