/**
 * Application-level errors carry an HTTP status and a stable machine code.
 * The API error handler turns them into { data: null, error: {...} } responses;
 * the voice tool executor turns them into spoken, caller-friendly messages.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(fields: Record<string, string>, message = "Validation failed") {
    super(422, "VALIDATION_ERROR", message, { fields });
  }
  get fields(): Record<string, string> {
    return (this.details?.fields as Record<string, string>) ?? {};
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Patient") {
    super(404, "NOT_FOUND", `${resource} not found`);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, "BAD_REQUEST", message, details);
  }
}
