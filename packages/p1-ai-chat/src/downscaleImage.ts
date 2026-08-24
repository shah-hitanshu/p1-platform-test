import { AttachmentError } from './attachments.js';

// The gateway refuses to fetch an image for us, so the bytes travel inside every request of
// the agent's tool loop. Shrinking here is what keeps that affordable, and a model reads a
// 1024px WebP as well as it reads a phone photo.

const MAX_EDGE = 1024;
const ENCODE_TYPE = 'image/webp';
const ENCODE_QUALITY = 0.8;
const MAX_ENCODED_BYTES = 4 * 1024 * 1024;

/** Scale to fit the long edge, never up: enlarging a small image adds bytes and no detail. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  // Rounded up, so a very wide image cannot round an edge down to zero.
  return { width: Math.max(1, Math.ceil(width * scale)), height: Math.max(1, Math.ceil(height * scale)) };
}

/** Roughly how many bytes a base64 payload stands for, without decoding it. */
export function dataUrlBytes(dataUrl: string): number {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

/**
 * Decode, shrink and re-encode an image in the browser. `createImageBitmap` rather than an
 * `<img>`: it needs no attached document, and the panel is a plugin Puck can re-render.
 */
export async function downscaleImage(file: File): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AttachmentError('This image could not be read.');
  }

  let canvas: HTMLCanvasElement | undefined;
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new AttachmentError('This browser could not prepare the image.');
    context.drawImage(bitmap, 0, 0, width, height);

    // A browser without WebP returns a PNG from the same call, so the type is read back
    // rather than assumed.
    const dataUrl = canvas.toDataURL(ENCODE_TYPE, ENCODE_QUALITY);
    if (!dataUrl.startsWith('data:image/')) {
      throw new AttachmentError('This image could not be prepared.');
    }
    if (dataUrlBytes(dataUrl) > MAX_ENCODED_BYTES) {
      throw new AttachmentError('This image is too detailed to send. Try a smaller one.');
    }
    return dataUrl;
  } finally {
    // Freed now rather than at the next GC, which matters when several arrive together. A canvas
    // has no close(); zeroing it is what frees the backing store.
    bitmap.close();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
