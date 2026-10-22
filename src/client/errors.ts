export interface ErrorOptions {
  code?: string | number;
  hint?: string;
  retryable?: boolean;
  details?: unknown;
}

/** A user-facing tool failure (bad arguments, permission gate, local IO, …). */
export class ToolError extends Error {
  readonly code?: string | number;
  readonly hint?: string;
  readonly retryable?: boolean;
  readonly details?: unknown;

  constructor(message: string, options: ErrorOptions = {}) {
    super(message);
    this.name = 'ToolError';
    this.code = options.code;
    this.hint = options.hint;
    this.retryable = options.retryable;
    this.details = options.details;
  }

  toPayload(): Record<string, unknown> {
    return {
      error: {
        message: this.message,
        ...(this.code !== undefined ? { code: this.code } : {}),
        ...(this.hint ? { hint: this.hint } : {}),
        ...(this.retryable !== undefined ? { retryable: this.retryable } : {}),
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

/** An error returned by the QQ OpenAPI (HTTP status and/or err_code). */
export class ApiError extends ToolError {
  readonly httpStatus?: number;
  readonly traceId?: string;
  readonly data?: unknown;

  constructor(message: string, options: ErrorOptions & { httpStatus?: number; traceId?: string; data?: unknown } = {}) {
    super(message, options);
    this.name = 'ApiError';
    this.httpStatus = options.httpStatus;
    this.traceId = options.traceId;
    this.data = options.data;
  }

  override toPayload(): Record<string, unknown> {
    return {
      error: {
        message: this.message,
        ...(this.code !== undefined ? { err_code: this.code } : {}),
        ...(this.httpStatus !== undefined ? { http_status: this.httpStatus } : {}),
        ...(this.traceId ? { trace_id: this.traceId } : {}),
        ...(this.hint ? { hint: this.hint } : {}),
        ...(this.retryable !== undefined ? { retryable: this.retryable } : {}),
        ...(this.data !== undefined ? { data: this.data } : {}),
      },
    };
  }
}

export class AuthError extends ApiError {
  constructor(message: string, options: ErrorOptions & { httpStatus?: number; traceId?: string } = {}) {
    super(message, { ...options, retryable: false });
    this.name = 'AuthError';
  }
}

export class RateLimitError extends ToolError {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message, { retryable: true });
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }

  override toPayload(): Record<string, unknown> {
    return {
      error: {
        message: this.message,
        retryable: true,
        retry_after_ms: this.retryAfterMs,
      },
    };
  }
}

export class TokenError extends ToolError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { ...options, retryable: false });
    this.name = 'TokenError';
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function toolErrorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof ToolError) return error.toPayload();
  return { error: { message: errorMessage(error) } };
}
