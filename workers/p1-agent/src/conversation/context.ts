import type { Attachment, AttachedFileName, ChatContext, PendingPage, SelectedBlock } from '../types.js';

/** All three fields are reported to the model as fact, so a partial selection is dropped. */
export function selectedBlockOf(context: ChatContext): SelectedBlock | null {
  const selected: unknown = context.selectedBlock;
  if (typeof selected !== 'object' || selected === null) return null;
  const { id, type, path, label, preview, itemCount } = selected as {
    id?: unknown; type?: unknown; path?: unknown;
    label?: unknown; preview?: unknown; itemCount?: unknown;
  };
  if (typeof id !== 'string' || id.trim() === '') return null;
  if (typeof type !== 'string' || type.trim() === '') return null;
  if (typeof path !== 'string' || path.trim() === '') return null;
  return {
    id: id.trim(),
    type: type.trim(),
    path: path.trim(),
    // A client too old to send a label leaves the type as its only name.
    label: typeof label === 'string' && label.trim() !== '' ? label.trim() : type.trim(),
    ...(typeof preview === 'string' && preview.trim() !== '' ? { preview: preview.trim() } : {}),
    ...(typeof itemCount === 'number' && Number.isInteger(itemCount) && itemCount > 1
      ? { itemCount }
      : {}),
  };
}
/** Matches the panel's own cap, and bounds what one turn's attachments can cost. */
const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_TEXT_CHARS = 20_000;
const MAX_FILENAME_LENGTH = 200;

/** The browser shrinks to 1024px, well under this: a backstop for a client that does not. */
const MAX_IMAGE_DATA_URL_CHARS = 8 * 1024 * 1024;

/**
 * What the panel encodes to, plus what a browser without WebP falls back to. AVIF is absent
 * deliberately: the Anthropic transport cannot carry it, and accepting it here would put a
 * file in the prompt as seen while the request travelled without it.
 */
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Reported to the model as the end of the brief, so a cut file does not read as a whole one. */
const TRUNCATION_MARKER = '\n\n[…the rest of this file was not included]';

function attachmentText(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.length > MAX_ATTACHMENT_TEXT_CHARS
    ? value.slice(0, MAX_ATTACHMENT_TEXT_CHARS) + TRUNCATION_MARKER
    : value;
}

/**
 * A base64 image data URI, or null. Copied into the provider request as it stands, so the
 * media type and the payload's alphabet are both checked rather than trusted.
 */
function attachmentDataUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_IMAGE_DATA_URL_CHARS) return null;
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return null;
  const [, mediaType, payload] = match;
  if (!IMAGE_MEDIA_TYPES.has(mediaType)) return null;
  // A base64 payload's length is always a multiple of four; anything else was truncated or
  // hand-assembled, and providers reject it unhelpfully.
  if (payload.length === 0 || payload.length % 4 !== 0) return null;
  return value;
}

function attachmentFilename(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > MAX_FILENAME_LENGTH) return null;
  return trimmed;
}

function parseAttachment(entry: unknown): Attachment | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const { kind, filename, text, dataUrl } = entry as {
    kind?: unknown; filename?: unknown; text?: unknown; dataUrl?: unknown;
  };
  const name = attachmentFilename(filename);
  if (name === null) return null;
  if (kind === 'document') {
    const body = attachmentText(text);
    return body === null ? null : { kind: 'document', filename: name, text: body };
  }
  if (kind === 'image') {
    const image = attachmentDataUrl(dataUrl);
    return image === null ? null : { kind: 'image', filename: name, dataUrl: image };
  }
  return null;
}

/** A turn's files: those that will travel, and separately why the rest will not. */
export interface ReadAttachments {
  attachments: Attachment[];
  /** Examined and rejected. A drop here is version skew or a bug in the client. */
  invalid: number;
  /** Arrived past the cap, so never examined. Nothing is wrong with them. */
  overLimit: number;
}

/**
 * Read the files a turn arrived with. Each variant's payload is checked, not just its `kind`:
 * both reach the prompt as fact, and an image is copied into a provider request.
 *
 * Only the first {@link MAX_ATTACHMENTS} are examined, so an oversized list cannot buy
 * unbounded validation work.
 */
export function readAttachments(context: ChatContext): ReadAttachments {
  const raw: unknown[] = Array.isArray(context.attachments) ? context.attachments : [];
  const examined = raw.slice(0, MAX_ATTACHMENTS);
  const attachments: Attachment[] = [];
  for (const entry of examined) {
    const attachment = parseAttachment(entry);
    if (attachment !== null) attachments.push(attachment);
  }
  return {
    attachments,
    invalid: examined.length - attachments.length,
    overLimit: raw.length - examined.length,
  };
}

export function attachmentsOf(context: ChatContext): Attachment[] {
  return readAttachments(context).attachments;
}

export function attachmentNames(attachments: Attachment[]): AttachedFileName[] {
  return attachments.map(({ kind, filename }) => ({ kind, filename }));
}

/** Read names off a stored entry: written by us, but read back after an arbitrary deploy. */
export function attachmentNamesOf(value: unknown): AttachedFileName[] {
  if (!Array.isArray(value)) return [];
  const names: AttachedFileName[] = [];
  for (const entry of value.slice(0, MAX_ATTACHMENTS)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { kind, filename } = entry as { kind?: unknown; filename?: unknown };
    if (kind !== 'image' && kind !== 'document') continue;
    const name = attachmentFilename(filename);
    if (name !== null) names.push({ kind, filename: name });
  }
  return names;
}
/**
 * Read a pending page off a context that crossed the network. Both fields decide where content
 * the user asked for gets written, so neither is taken on trust.
 */
export function pendingPageOf(context: ChatContext): PendingPage | null {
  const pending: unknown = context.pendingPage;
  if (typeof pending !== 'object' || pending === null) return null;
  const { title, path } = pending as { title?: unknown; path?: unknown };
  if (typeof path !== 'string' || path.trim() === '') return null;
  return { title: typeof title === 'string' ? title : '', path: path.trim() };
}
