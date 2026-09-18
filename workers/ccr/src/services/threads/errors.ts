/** An input that passed shape validation but names something the site does not own or recognise. */
export class ThreadInputError extends Error {
  public readonly name = 'ThreadInputError';
  public readonly details: string[];

  constructor(
    public readonly field: string,
    message: string,
    details?: string[],
  ) {
    super(message);
    this.details = details ?? [message];
    Object.setPrototypeOf(this, ThreadInputError.prototype);
  }
}

/** The caller may take part in the thread but not touch this particular comment. */
export class ThreadForbiddenError extends Error {
  public readonly name = 'ThreadForbiddenError';

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ThreadForbiddenError.prototype);
  }
}
