import type { Config } from '../config.js';
import type { ApiSpec, JsonSchema } from '../types.js';
import type { Catalog } from '../catalog.js';
import type { Logger } from '../util/logger.js';
import { ApiError, AuthError, RateLimitError, ToolError, errorMessage } from './errors.js';
import { DEFAULT_READ_LIMIT, DEFAULT_WRITE_LIMIT, RateLimiter } from './ratelimit.js';
import type { TokenManager } from './token.js';

export interface ApiCallOptions {
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  signal?: AbortSignal;
}

export interface ApiCallResult {
  ok: true;
  httpStatus: number;
  data: unknown;
  traceId?: string;
  url: string;
  pendingAudit?: boolean;
}

export interface MultipartFile {
  field: string;
  filename: string;
  contentType: string;
  data: Uint8Array;
}

interface RawResponse {
  status: number;
  headers: Headers;
  data: unknown;
  text: string;
}

const AUTH_ERROR_CODES = new Set([11241, 11243]);
const AUDIT_PENDING_CODES = new Set([304023, 304024]);

const ERROR_HINTS: Record<string, string> = {
  '11253': 'The bot has not been granted this API permission. Apply for it in the QQ Open Platform console (some endpoints are whitelist-only).',
  '11264': 'The bot was not granted this guild permission when it was added; re-add the bot or request authorization.',
  '304018': 'Channel messages require the bot to be connected to the WebSocket gateway. Call start_event_stream (or enable QQBOT_MCP_EVENT_AUTOSTART) first.',
  '40034100': 'Active-message rate limit exceeded. Wait for the quota to reset or reply passively using msg_id.',
  '40034128': 'Passive reply window/count exceeded. Reply within 5 minutes of the event, at most the allowed number of times.',
  '40034005': 'msg_id has expired; passive replies must be sent within the event window.',
  '40034006': 'Message content rejected by moderation.',
  '40054002': 'The bot is muted in this group; wait until the mute expires.',
  '40054003': 'The bot is not a member of this group.',
  '40054005': 'Duplicate message: msg_id + msg_seq was already used. Increment msg_seq.',
  '40054007': 'Message too long; shorten the content.',
  '40054010': 'URLs are not allowed in this message.',
  '40093002': 'Daily file upload capacity exceeded.',
  '600001': 'Webhook signature validation failed.',
};

export class QqBotClient {
  readonly limiter: RateLimiter;

  constructor(
    readonly config: Config,
    readonly catalog: Catalog,
    readonly tokenManager: TokenManager,
    private readonly logger: Logger,
    options: { rateLimit?: boolean } = {},
  ) {
    this.limiter = new RateLimiter(options.rateLimit ?? config.rateLimit);
  }

  getApi(name: string): ApiSpec {
    return this.catalog.requireApi(name);
  }

  async call(apiName: string, options: ApiCallOptions = {}): Promise<ApiCallResult> {
    return this.request(this.getApi(apiName), options);
  }

  async request(api: ApiSpec, options: ApiCallOptions = {}): Promise<ApiCallResult> {
    if (api.method === 'GET' && options.body && Object.keys(options.body).length > 0) {
      throw new ToolError(`GET ${api.path} takes query parameters, not a body.`, {
        hint: 'Put filters in "query" instead of "body".',
      });
    }
    const url = this.buildUrl(api, options.path, options.query);
    this.limiter.acquire(`${api.method} ${api.path}`, api.rateLimit, api.readOnly ? DEFAULT_READ_LIMIT : DEFAULT_WRITE_LIMIT);
    const bodyText = api.method === 'GET' || options.body === undefined ? undefined : JSON.stringify(options.body);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (bodyText !== undefined) headers['content-type'] = 'application/json; charset=utf-8';

    let token = await this.tokenManager.get();
    let retriedAuth = false;
    let retriedServer = false;
    for (;;) {
      let response: RawResponse;
      try {
        response = await this.perform(url, {
          method: api.method,
          headers: { ...headers, authorization: `QQBot ${token}` },
          body: bodyText,
          signal: options.signal,
        });
      } catch (error) {
        if (error instanceof ToolError) throw error;
        throw new ApiError(`Request to ${api.method} ${api.path} failed: ${errorMessage(error)}`, {
          hint: 'Check network connectivity to QQBOT_API_BASE.',
          retryable: true,
        });
      }

      const responseCode = numericCode(response.data);
      if (response.status === 401 || (responseCode !== undefined && AUTH_ERROR_CODES.has(responseCode))) {
        if (!retriedAuth) {
          retriedAuth = true;
          this.tokenManager.invalidate(token);
          token = await this.tokenManager.get(true);
          this.logger.warn('QQ access_token rejected; refreshed and retrying once.', { api: api.name });
          continue;
        }
        throw new AuthError('QQ API authentication failed after refreshing the access_token.', {
          httpStatus: response.status,
          traceId: traceIdOf(response),
        });
      }

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after') ?? '0');
        throw new RateLimitError(
          `QQ API rate limit hit for ${api.name}.`,
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1_000,
        );
      }

      if (response.status >= 500 && !retriedServer && api.method === 'GET') {
        retriedServer = true;
        await sleep(300);
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        const code = numericCode(response.data);
        throw this.apiError(api, response, `QQ API ${api.method} ${api.path} returned HTTP ${response.status}.`);
      }

      const body = response.data;
      if (isRecord(body) && typeof body.err_code === 'number' && body.err_code !== 0) {
        if (AUDIT_PENDING_CODES.has(body.err_code)) {
          return {
            ok: true,
            httpStatus: response.status,
            data: body,
            traceId: traceIdOf(response),
            url,
            pendingAudit: true,
          };
        }
        throw this.apiError(api, response, typeof body.message === 'string' ? body.message : `QQ API error ${body.err_code}.`);
      }
      if (isRecord(body) && typeof body.code === 'number' && body.code >= 400000) {
        throw this.apiError(api, response, typeof body.message === 'string' ? body.message : `QQ API error ${body.code}.`);
      }

      this.logger.debug('QQ API call succeeded.', { api: api.name, status: response.status });
      return { ok: true, httpStatus: response.status, data: body, traceId: traceIdOf(response), url };
    }
  }

  /** Send multipart/form-data (channel message local image upload). */
  async requestMultipart(
    api: ApiSpec,
    file: MultipartFile,
    fields: Record<string, unknown> = {},
    options: { path?: Record<string, unknown>; query?: Record<string, unknown>; signal?: AbortSignal } = {},
  ): Promise<ApiCallResult> {
    const url = this.buildUrl(api, options.path, options.query);
    this.limiter.acquire(`${api.method} ${api.path}`, api.rateLimit, DEFAULT_WRITE_LIMIT);
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
    const bytes = new Uint8Array(file.data);
    form.append(file.field, new Blob([bytes], { type: file.contentType }), file.filename);

    let token = await this.tokenManager.get();
    let retriedAuth = false;
    for (;;) {
      let response: RawResponse;
      try {
        response = await this.perform(url, {
          method: api.method,
          headers: { authorization: `QQBot ${token}` },
          body: form,
          signal: options.signal,
        });
      } catch (error) {
        if (error instanceof ToolError) throw error;
        throw new ApiError(`Multipart request to ${api.method} ${api.path} failed: ${errorMessage(error)}`, {
          retryable: true,
        });
      }
      if (response.status === 401 && !retriedAuth) {
        retriedAuth = true;
        this.tokenManager.invalidate(token);
        token = await this.tokenManager.get(true);
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        throw this.apiError(api, response, `QQ API ${api.method} ${api.path} returned HTTP ${response.status}.`);
      }
      if (isRecord(response.data) && typeof response.data.err_code === 'number' && response.data.err_code !== 0) {
        throw this.apiError(api, response, String(response.data.message ?? `QQ API error ${response.data.err_code}.`));
      }
      return {
        ok: true,
        httpStatus: response.status,
        data: response.data,
        traceId: traceIdOf(response),
        url,
      };
    }
  }

  /** PUT to a COS presigned URL (no QQ auth header, long timeout). */
  async putPresigned(
    url: string,
    data: Uint8Array,
    contentType = 'application/octet-stream',
    signal?: AbortSignal,
  ): Promise<{ etag?: string }> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': contentType },
        body: new Uint8Array(data),
        signal: AbortSignal.any([AbortSignal.timeout(300_000), ...(signal ? [signal] : [])]),
      });
    } catch (error) {
      throw new ToolError(`Failed to upload to presigned URL: ${errorMessage(error)}`, { retryable: true });
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ToolError(`Presigned upload failed with HTTP ${response.status}.`, {
        details: text.slice(0, 500),
        retryable: response.status >= 500,
      });
    }
    const etag = response.headers.get('etag')?.replace(/^"|"$/g, '');
    await response.arrayBuffer().catch(() => undefined);
    return etag ? { etag } : {};
  }

  private buildUrl(api: ApiSpec, pathValues?: Record<string, unknown>, query?: Record<string, unknown>): string {
    const missing: string[] = [];
    const path = api.path.replace(/\{([^}/]+)\}/g, (_, name: string) => {
      const value = pathValues?.[name];
      if (value === undefined || value === null || String(value).trim() === '') {
        missing.push(name);
        return `{${name}}`;
      }
      return encodeURIComponent(String(value));
    });
    if (missing.length > 0) {
      throw new ToolError(`Missing required path parameter(s) for ${api.name}: ${missing.join(', ')}.`, {
        hint: `Provide them in the "path" object, e.g. {"path":{"${missing[0]}":"…"}}.`,
      });
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) params.append(key, stringifyQueryValue(item));
      } else {
        params.append(key, stringifyQueryValue(value));
      }
    }
    const search = params.toString();
    return `${this.config.apiBase}${path}${search ? `?${search}` : ''}`;
  }

  private async perform(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string | FormData; signal?: AbortSignal },
  ): Promise<RawResponse> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const signal = init.signal ? AbortSignal.any([timeout, init.signal]) : timeout;
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new ToolError(`QQ API request timed out after ${this.config.timeoutMs}ms.`, { retryable: true });
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ToolError('Request cancelled by the MCP client.');
      }
      throw error;
    }
    const text = await response.text();
    let data: unknown = text;
    const contentType = response.headers.get('content-type') ?? '';
    if (text && (contentType.includes('json') || /^[\[{]/.test(text.trim()))) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    } else if (!text) {
      data = {};
    }
    return { status: response.status, headers: response.headers, data, text };
  }

  private apiError(api: ApiSpec, response: RawResponse, fallback: string): ApiError {
    const body = isRecord(response.data) ? response.data : undefined;
    const code = numericCode(response.data);
    const message = body && typeof body.message === 'string' ? body.message : fallback;
    const explanation = this.catalog.explainError(code);
    const hint = (code !== undefined ? ERROR_HINTS[String(code)] : undefined) ?? explanation?.hint;
    return new ApiError(message, {
      code,
      httpStatus: response.status,
      traceId: traceIdOf(response),
      data: safeData(response.data),
      hint,
      retryable: response.status === 429 || response.status >= 500,
    });
  }
}

function stringifyQueryValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function traceIdOf(response: RawResponse): string | undefined {
  const header = response.headers.get('x-tps-trace-id') ?? undefined;
  if (header) return header;
  if (isRecord(response.data) && typeof response.data.trace_id === 'string') return response.data.trace_id;
  return undefined;
}

function numericCode(data: unknown): number | undefined {
  if (!isRecord(data)) return undefined;
  if (typeof data.err_code === 'number') return data.err_code;
  if (typeof data.code === 'number') return data.code;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeData(data: unknown): unknown {
  if (typeof data === 'string') return data.slice(0, 2000);
  return data;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lightweight argument validation used by tools before calling QQ. */
export function validateObjectAgainstSchema(
  value: Record<string, unknown> | undefined,
  schema: JsonSchema | undefined,
  label: string,
): void {
  if (!schema) return;
  const required = schema.required ?? [];
  for (const key of required) {
    if (value?.[key] === undefined || value?.[key] === null) {
      throw new ToolError(`${label}.${key} is required.`, { hint: 'Call get_api for the full parameter schema.' });
    }
  }
  if (!value) return;
  for (const [key, fieldValue] of Object.entries(value)) {
    const property = schema.properties?.[key];
    if (!property || fieldValue === undefined || fieldValue === null) continue;
    const expected = property.type;
    if (!expected) continue;
    const actual = Array.isArray(fieldValue) ? 'array' : typeof fieldValue;
    const matches =
      (expected === 'integer' && actual === 'number' && Number.isInteger(fieldValue)) ||
      (expected === 'number' && actual === 'number') ||
      (expected === 'string' && actual === 'string') ||
      (expected === 'boolean' && actual === 'boolean') ||
      (expected === 'array' && actual === 'array') ||
      (expected === 'object' && actual === 'object');
    if (!matches) {
      throw new ToolError(`${label}.${key} must be ${expected}, got ${actual}.`, {
        hint: 'Call get_api to inspect the schema.',
      });
    }
  }
}
