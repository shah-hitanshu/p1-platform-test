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
