import type { AttachedFile, Attachment, PendingAttachment } from '../../types.js';

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
