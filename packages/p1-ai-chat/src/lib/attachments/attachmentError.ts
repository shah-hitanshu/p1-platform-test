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
