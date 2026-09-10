import { contentTypeFor } from './contentType.js';

/** The file was kept once and has since expired, or the conversation was cleared. */
export class AttachmentGoneError extends Error {}

/** The service refused the request and said why, in words meant to be shown. */
export class AttachmentRejectedError extends Error {}

/**
 * Timeout for the small JSON calls. Recording happens inside the same wait as opening the
 * socket, so an unresponsive media API would hold the turn open indefinitely. The upload
 * itself is deliberately unbounded: it can be megabytes, and nothing waits on it.
 */
const MEDIA_TIMEOUT_MS = 15_000;

/**
 * For the file as uploaded, which runs to the service's upload cap: the short budget above
 * aborts a large one on a slow connection, and the preview shows that as a permanent failure
 * with no retry. Still bounded — a spinner is waiting on it. A resized thumbnail is a small
 * response and keeps the short budget rather than holding a connection open per visible card.
 */
const CONTENT_TIMEOUT_MS = 60_000;

/** Which media service to talk to, and as whom. Resolved from the chat context. */
export interface MediaTarget {
  workerUrl: string;
  siteId: string;
  token: string;
}

/** What presign produces and finalize needs. */
export interface PresignedChatUpload {
  assetId: string;
  versionId: string;
  /** Sanitized server-side, so it may differ from the file's own name. */
  filename: string;
}

interface PresignResponse extends PresignedChatUpload {
  uploadUrl: string;
}

function post(target: MediaTarget, path: string, body: unknown): Promise<Response> {
  const url = `${target.workerUrl}${path}?siteId=${encodeURIComponent(target.siteId)}`;
  return fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${target.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  });
}

/**
 * Reserves storage for a file and sends the bytes to it. Nothing is recorded until
 * {@link finalizeChatUpload} runs, so a file abandoned here leaves only bytes behind. The
 * server sweeps those.
 */
export async function presignAndPut(
  target: MediaTarget,
  file: File,
): Promise<PresignedChatUpload> {
  // Both legs must use the same value: the upload URL is signed over it, and a mismatch
  // comes back as an opaque signature rejection from the storage layer.
  const contentType = contentTypeFor(file);

  const reserved = await post(target, '/media/presign', {
    filename: file.name,
    contentType,
    size: file.size,
    origin: 'chat',
  });
  if (!reserved.ok) throw new Error(`Attachment presign failed (${reserved.status})`);
  const { assetId, versionId, filename, uploadUrl } = (await reserved.json()) as PresignResponse;

  const sent = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': contentType },
  });
  if (!sent.ok) throw new Error(`Attachment upload failed (${sent.status})`);

  return { assetId, versionId, filename };
}

/**
 * Records the upload. Until this runs the file cannot be fetched back. Kept separate from
 * {@link presignAndPut} and called only when a turn is sent, so a file the user stages and
 * then removes is never recorded; its bytes stay unreferenced and get swept.
 */
export async function finalizeChatUpload(
  target: MediaTarget,
  upload: PresignedChatUpload,
): Promise<string> {
  const recorded = await post(target, '/media/finalize', {
    assetId: upload.assetId,
    versionId: upload.versionId,
    filename: upload.filename,
    origin: 'chat',
  });
  if (!recorded.ok) throw new Error(`Attachment finalize failed (${recorded.status})`);
  return upload.assetId;
}

/** Fetches a kept file back. Authenticated, so this can serve text as well as images. */
export async function fetchKeptAttachment(
  target: MediaTarget,
  assetId: string,
  /** Resize an image server-side. Omit for the file as it was uploaded. */
  width?: number,
): Promise<Blob> {
  const url =
    `${target.workerUrl}/media/${encodeURIComponent(assetId)}/content` +
    `?siteId=${encodeURIComponent(target.siteId)}` +
    (width === undefined ? '' : `&width=${String(width)}`);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${target.token}` },
    signal: AbortSignal.timeout(width === undefined ? CONTENT_TIMEOUT_MS : MEDIA_TIMEOUT_MS),
  });
  // A distinct error, so the caller can tell "expired" from "request failed".
  if (response.status === 404) throw new AttachmentGoneError();
  if (!response.ok) throw new Error(`Attachment fetch failed (${response.status})`);
  return response.blob();
}

/**
 * Whether a kept image is currently a library asset. The service sends `origin` only while a
 * file is still chat-scoped, so an absent `origin` means it is in the library. A 404 means the
 * library does not hold it: deleted there, and still readable here off the chat's reference.
 */
export async function isKeptAttachmentInLibrary(
  target: MediaTarget,
  assetId: string,
): Promise<boolean> {
  const url =
    `${target.workerUrl}/media/${encodeURIComponent(assetId)}` +
    `?siteId=${encodeURIComponent(target.siteId)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${target.token}` },
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Attachment lookup failed (${response.status})`);
  const asset: unknown = await response.json();
  // Checked, not cast. An absent `origin` means "in the library", so a body that isn't an
  // asset would come back as a yes and hide the button.
  if (typeof asset !== 'object' || asset === null || Array.isArray(asset)) {
    throw new Error('Attachment lookup returned something other than an asset');
  }
  return (asset as { origin?: unknown }).origin !== 'chat';
}

/** One field the library records about an asset, as the media service advertises it. */
export interface MediaField {
  name: string;
  label: string;
}

/**
 * The fields the library collects. Read from the service instead of hardcoded here, so this
 * form stays in step with the library's own upload form.
 */
export async function fetchMediaFields(workerUrl: string): Promise<MediaField[]> {
  const response = await fetch(`${workerUrl}/media/schema`, {
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Media schema fetch failed (${response.status})`);
  const fields = (await response.json()) as unknown;
  if (!Array.isArray(fields)) throw new Error('Media schema was not a list');
  return fields.filter((field): field is MediaField =>
    typeof field === 'object' && field !== null
    && typeof (field as MediaField).name === 'string'
    && typeof (field as MediaField).label === 'string');
}

/**
 * Moves a kept file into the site's media library, where it can be placed on a page and stops
 * expiring. Images only, enforced by the service. Metadata is sent with the promotion so the
 * asset is never in the library unlabelled.
 */
export async function addKeptAttachmentToLibrary(
  target: MediaTarget,
  assetId: string,
  metadata: Record<string, string>,
): Promise<void> {
  const url =
    `${target.workerUrl}/media/${encodeURIComponent(assetId)}/promote` +
    `?siteId=${encodeURIComponent(target.siteId)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${target.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata }),
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  });
  if (response.status === 404) throw new AttachmentGoneError();
  if (response.ok) return;
  // A 4xx is actionable (over-long caption, a file type the library won't take) and the
  // service already phrases it for the user. A 5xx tells them nothing useful.
  const reason = response.status < 500 ? await refusalReason(response) : undefined;
  if (reason !== undefined) throw new AttachmentRejectedError(reason);
  throw new Error(`Add to library failed (${response.status})`);
}

async function refusalReason(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === 'string' && body.error !== '' ? body.error : undefined;
  } catch {
    return undefined;
  }
}
