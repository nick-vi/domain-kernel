export class CliParseError extends Error {
  override readonly name = 'CliParseError';

  constructor(
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}
