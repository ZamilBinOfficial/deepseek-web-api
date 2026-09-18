/** Error helpers keep transport status separate from internal failure details. */
export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    if (code !== undefined) this.code = code;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorStatus(error: unknown): number {
  return error instanceof HttpError ? error.status : 500;
}
