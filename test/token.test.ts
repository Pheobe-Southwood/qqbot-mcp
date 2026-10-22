import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenManager } from '../src/client/token.js';
import { TokenError } from '../src/client/errors.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function manager(overrides: Partial<ConstructorParameters<typeof TokenManager>[0]> = {}) {
  return new TokenManager({
    appId: 'app',
    appSecret: 'secret',
    tokenUrl: 'https://api.example.test/app/getAppAccessToken',
    timeoutMs: 5_000,
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TokenManager', () => {
  it('fetches a token, caches it and sends appId/clientSecret', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ access_token: 'tok-1', expires_in: 7200 }));
    vi.stubGlobal('fetch', fetchMock);
    const tokens = manager();
    expect(await tokens.get()).toBe('tok-1');
    expect(await tokens.get()).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.test/app/getAppAccessToken');
    expect(JSON.parse(String(init.body))).toEqual({ appId: 'app', clientSecret: 'secret' });
    expect(tokens.status()).toMatchObject({ configured: true, source: 'app', valid: true });
  });

  it('single-flights concurrent requests', async () => {
    let release: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const tokens = manager();
    const pending = Promise.all([tokens.get(), tokens.get(), tokens.get()]);
    release(json({ access_token: 'tok', expires_in: 7200 }));
    expect(await pending).toEqual(['tok', 'tok', 'tok']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes after invalidate', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: 'tok-1', expires_in: 7200 }))
      .mockResolvedValueOnce(json({ access_token: 'tok-2', expires_in: 7200 }));
    vi.stubGlobal('fetch', fetchMock);
    const tokens = manager();
    expect(await tokens.get()).toBe('tok-1');
    tokens.invalidate('tok-1');
    expect(await tokens.get()).toBe('tok-2');
  });

  it('uses a static token without network calls', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const tokens = manager({ staticToken: 'static' });
    expect(await tokens.get()).toBe('static');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tokens.status()).toMatchObject({ source: 'static', valid: true });
  });

  it('surfaces QQ token error codes with hints', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ code: 100016, message: 'invalid appid' })));
    const tokens = manager();
    const error = await tokens.get().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TokenError);
    expect(error).toMatchObject({ code: 100016, hint: expect.stringContaining('AppID') });
  });

  it('rejects a successful HTTP response without access_token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ expires_in: 7200 })));
    await expect(manager().get()).rejects.toThrow(/did not include access_token/);
  });

  it('reports missing credentials clearly', async () => {
    const tokens = manager({ appId: undefined, appSecret: undefined });
    await expect(tokens.get()).rejects.toThrow(/No QQ bot credentials/);
    expect(tokens.status()).toMatchObject({ configured: false, source: 'none', valid: false });
  });
});
