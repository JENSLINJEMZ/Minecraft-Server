/** Typed application error carrying an HTTP status and a stable error code. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = 'Bad request', details?: unknown) {
    return new AppError(400, 'bad_request', message, details);
  }
  static unauthorized(message = 'Not authenticated') {
    return new AppError(401, 'unauthorized', message);
  }
  static forbidden(message = 'Forbidden') {
    return new AppError(403, 'forbidden', message);
  }
  static notFound(message = 'Not found') {
    return new AppError(404, 'not_found', message);
  }
  static conflict(message = 'Conflict') {
    return new AppError(409, 'conflict', message);
  }
  static tooMany(message = 'Too many requests') {
    return new AppError(429, 'too_many_requests', message);
  }
  static internal(message = 'Internal server error') {
    return new AppError(500, 'internal_error', message);
  }
  static notConfigured(message = 'Feature not configured') {
    return new AppError(503, 'not_configured', message);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
