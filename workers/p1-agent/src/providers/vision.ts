import type OpenAI from 'openai';
import type { Env } from '../env.js';
import type { Attachment } from '../types.js';

// The gateway will not fetch an image for us — it answers `image_url only supports base64
// encoded image data` — so an image travels inline, already shrunk by the browser. Nothing is
// stored: an image belongs to the turn it arrived on.

/**
 * The image parts for a turn's user message, in the order they were attached. Empty when the
 * turn carried no images, so a text-only turn keeps sending plain string content.
 *
 * Takes {@link attachmentsOf} output, which is what caps the count and makes each `dataUrl`
 * safe to copy into a provider request.
 */
export function imageParts(
  attachments: Attachment[],
): OpenAI.Chat.Completions.ChatCompletionContentPartImage[] {
  return attachments
    .filter(attachment => attachment.kind === 'image')
    .map(image => ({ type: 'image_url' as const, image_url: { url: image.dataUrl } }));
}

/** The media type and payload of a `data:<type>;base64,<data>` URI, or null. */
export function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  return match ? { mediaType: match[1], data: match[2] } : null;
}

/**
 * Whether this model can be shown an image. One answer for both the bytes and the prompt:
 * telling a model to look at an image it was never sent is what gets one described unseen.
 *
 * Compared literally, because `Boolean("false")` is true.
 */
export function modelSeesImages(env: Env, model: string, defaultModel: string): boolean {
  const configured = env.AGENT_MODEL_VISION?.trim().toLowerCase();
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  // Unset: only where capability is a fact we hold. `@cf/*` mixes both kinds behind one
  // prefix, so a bare id there earns no assumption.
  return model === defaultModel || model.startsWith('anthropic/');
}
