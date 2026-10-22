import type { CacheStatus } from '../types.js';
import { TokenError } from './errors.js';

export interface TokenManagerOptions {
  appId?: string;
  appSecret?: string;
  tokenUrl: string;
  staticToken?: string;
  timeoutMs: number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: string | number;
  code?: number;
  message?: string;
}

/**
 * QQ access_token manager: lazy fetch, refresh 60s before expiry, single-flight
 * (concurrent callers share one request), explicit invalidate on 401/11243.
 */
export class TokenManager {
  private token?: string;
  private expiresAt = 0;
  private inflight?: Promise<string>;

  constructor(private readonly options: TokenManagerOptions) {}

  async get(force = false): Promise<string> {
    if (this.options.staticToken) return this.options.staticToken;
    if (!this.options.appId || !this.options.appSecret) {
      throw new TokenError('No QQ bot credentials configured (QQBOT_APP_ID + QQBOT_APP_SECRET).', {
        hint: 'Set both variables (or QQBOT_ACCESS_TOKEN for a static token) and restart the MCP server.',
      });
    }
    if (!force && this.token && Date.now() < this.expiresAt) return this.token;
    if (!this.inflight) {
      const promise = this.fetchToken().finally(() => {
        if (this.inflight === promise) this.inflight = undefined;
      });
      this.inflight = promise;
    }
    return this.inflight;
  }

  invalidate(current?: string): void {
    if (current && this.token && current !== this.token) return;
    this.token = undefined;
    this.expiresAt = 0;
  }

  status(): CacheStatus {
    if (this.options.staticToken) {
      return { configured: true, source: 'static', expiresAt: null, valid: true };
    }
    if (!this.options.appId || !this.options.appSecret) {
      return { configured: false, source: 'none', expiresAt: null, valid: false };
    }
    return {
      configured: true,
      source: 'app',
      expiresAt: this.expiresAt || null,
      valid: Boolean(this.token && Date.now() < this.expiresAt),
    };
  }

  private async fetchToken(): Promise<string> {
    const { appId, appSecret, tokenUrl, timeoutMs } = this.options;
    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appId, clientSecret: appSecret }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new TokenError(`Failed to request QQ access_token: ${error instanceof Error ? error.message : String(error)}`, {
        retryable: true,
      });
    }
    const text = await response.text();
    let payload: TokenResponse;
    try {
      payload = text ? (JSON.parse(text) as TokenResponse) : {};
    } catch {
      throw new TokenError(`Invalid access_token response from QQ (HTTP ${response.status}).`, {
        details: text.slice(0, 500),
      });
    }
    if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
      const code = payload.code ?? response.status;
      const hint =
        code === 100016
          ? 'AppID or AppSecret is incorrect; verify them in the QQ Open Platform console.'
          : code === 100001
            ? 'Too many token requests; back off and retry.'
            : code === 100007
              ? 'AppID is invalid or the bot is banned/deleted.'
              : undefined;
      throw new TokenError(payload.message || `Failed to obtain access_token (code ${code}).`, {
        code,
        hint,
      });
    }
    if (!payload.access_token) {
      throw new TokenError('QQ access_token response did not include access_token.');
    }
    const expiresIn = Number(payload.expires_in ?? 7200);
    const lifetimeSeconds = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 7200;
    // Refresh 60 seconds early (never earlier than half the lifetime).
    const refreshMargin = Math.min(60, Math.floor(lifetimeSeconds / 2));
    this.token = payload.access_token;
    this.expiresAt = Date.now() + (lifetimeSeconds - refreshMargin) * 1000;
    return payload.access_token;
  }
}
