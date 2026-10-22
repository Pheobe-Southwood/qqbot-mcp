import { afterEach, describe, expect, it, vi } from 'vitest';
import { Catalog } from '../src/catalog.js';
import { QqBotClient, validateObjectAgainstSchema } from '../src/client/http.js';
import { ApiError, RateLimitError, ToolError } from '../src/client/errors.js';
import type { TokenManager } from '../src/client/token.js';
import { resolveConfig, type Config } from '../src/config.js';
import { Logger } from '../src/util/logger.js';
import type { ApiSpec } from '../src/types.js';

const catalog = Catalog.load();
const logger = new Logger('error');

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function api(overrides: Partial<ApiSpec> = {}): ApiSpec {
  return {
    name: 'test_api',
    aliases: [],
    category: 'test',
    summary: 'test',
    description: 'test',
    notes: [],
    method: 'GET',
    path: '/test',
    readOnly: true,
    legacy: false,
    deprecated: false,
    permissionRequired: false,
    rateLimit: '',
    docUrl: 'https://bot.q.qq.com/wiki/',
    docTitle: 'test',
    pathParams: [],
    queryParams: [],
    bodyParams: [],
    bodySchema: { type: 'object', properties: {} },
    querySchema: { type: 'object', properties: {} },
    pathSchema: { type: 'object', properties: {} },
    multipartFields: [],
    response: { description: '', fields: [] },
    errors: [],
    examples: [],
    inputSchema: { type: 'object', properties: {} },
    warnings: [],
    ...overrides,
  };
}

function config(overrides: Partial<Config> = {}): Config {
  const resolved = resolveConfig({
    QQBOT_ACCESS_TOKEN: 'static-token',
    QQBOT_MCP_MODE: 'write',
    QQBOT_MCP_RATE_LIMIT: 'off',
  }).config;
  return { ...resolved, ...overrides };
}

function fakeTokens(): TokenManager {
  return {
    get: vi.fn(async () => 'tok'),
    invalidate: vi.fn(),
    status: vi.fn(() => ({ configured: true, source: 'static', expiresAt: null, valid: true })),
  } as unknown as TokenManager;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('QQ HTTP client', () => {
  it('calls the documented URL with QQBot auth and returns trace ids', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({ url: 'wss://api.sgroup.qq.com/websocket/' }, 200, { 'x-tps-trace-id': 'trace-1' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new QqBotClient(config(), catalog, fakeTokens(), logger);
    const result = await client.call('get_gateway_bot');
    expect(result.data).toEqual({ url: 'wss://api.sgroup.qq.com/websocket/' });
    expect(result.traceId).toBe('trace-1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.bot.qq.com/gateway/bot');
    expect((init.headers as Record<string, string>).authorization).toBe('QQBot tok');
  });

  it('encodes path parameters and repeats array query values', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QqBotClient(config(), catalog, fakeTokens(), logger);
    const testApi = api({
      path: '/test/{id}',
      pathSchema: { type: 'object', properties: { id: { type: 'string' } } },
    });
    await client.request(testApi, { path: { id: 'a/b c' }, query: { tag: ['x', 'y'], limit: 2 } });
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/test/a%2Fb%20c?');
    expect(url).toContain('tag=x');
    expect(url).toContain('tag=y');
    expect(url).toContain('limit=2');
  });

  it('omits the body on GET even when an empty body object is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QqBotClient(config(), catalog, fakeTokens(), logger);
    await client.request(api(), { body: {} });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined();
  });

  it('fails fast when a path parameter is missing', async () => {
    const client = new QqBotClient(config(), catalog, fakeTokens(), logger);
    await expect(client.request(api({ path: '/test/{id}' }))).rejects.toBeInstanceOf(ToolError);
    await expect(client.request(api({ path: '/test/{id}' }))).rejects.toThrow(/Missing required path parameter/);
  });

  it('throws ApiError with err_code, trace id and a targeted hint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ err_code: 40054005, message: 'duplicate msg', trace_id: 'body-trace' })),
    );
    const client = new QqBotClient(config(), catalog, fakeTokens(), logger);
    const error = await client.call('send_group_message', {
      path: { group_openid: 'g' },
      body: { msg_type: 0, content: 'hi' },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 40054005, traceId: 'body-trace' });
    expect((error as ApiError).hint).toContain('msg_seq');
  });

  it('refreshes the token once on 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ message: 'unauthorized' }, 401))
      .mockResolvedValueOnce(json({ url: 'wss://x' }));
    vi.stubGlobal('fetch', fetchMock);
    const tokens = fakeTokens();
    (tokens.get as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('tok-1')
      .mockResolvedValueOnce('tok-2');
    const client = new QqBotClient(config(), catalog, tokens, logger);
    const result = await client.call('get_gateway_bot');
    expect(result.data).toEqual({ url: 'wss://x' });
    expect(tokens.invalidate).toHaveBeenCalledWith('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1]![1].headers as Record<string, string>).authorization).toBe('QQBot tok-2');
  });

  it('retries a GET once on 5xx', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ message: 'boom' }, 503))
      .mockResolvedValueOnce(json({ url: 'wss://x' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QqBotClient(config(), catalog, fakeTokens(), logger);
    const result = await client.call('get_gateway_bot');
    expect(result.data).toEqual({ url: 'wss://x' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('marks 304023/304024 message audit responses as success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ err_code: 304023, message: 'audit pending' })));
    const client = new QqBotClient(config(), catalog, fakeTokens(), logger);
    const result = await client.call('send_channel_message', {
      path: { channel_id: 'c' },
      body: { content: 'hi' },
    });
    expect(result.pendingAudit).toBe(true);
  });

  it('enforces the local rate limiter before calling fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QqBotClient(config({ rateLimit: true }), catalog, fakeTokens(), logger);
    const testApi = api({ rateLimit: '1 QPS' });
    await client.request(testApi);
    await expect(client.request(testApi)).rejects.toBeInstanceOf(RateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends channel file_image as multipart/form-data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ id: 'msg-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new QqBotClient(config(), catalog, fakeTokens(), logger);
    const send = catalog.requireApi('send_channel_message');
    const result = await client.requestMultipart(
      send,
      {
        field: 'file_image',
        filename: 'a.png',
        contentType: 'image/png',
        data: Buffer.from('png-bytes'),
      },
      { content: 'hi', markdown: { content: '**hi**' } },
      { path: { channel_id: 'chan' } },
    );
    expect(result.data).toEqual({ id: 'msg-1' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.bot.qq.com/channels/chan/messages');
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('content')).toBe('hi');
    expect(form.get('markdown')).toBe(JSON.stringify({ content: '**hi**' }));
    const file = form.get('file_image') as File;
    expect(file.name).toBe('a.png');
    expect(await file.text()).toBe('png-bytes');
  });

  it('validates argument types against a JSON schema', () => {
    const schema = catalog.requireApi('send_group_message').bodySchema;
    expect(() => validateObjectAgainstSchema({ msg_type: 'zero' }, schema, 'body')).toThrow(/must be integer/);
    expect(() => validateObjectAgainstSchema({}, schema, 'body')).toThrow(/msg_type is required/);
    expect(() => validateObjectAgainstSchema({ msg_type: 0 }, schema, 'body')).not.toThrow();
  });
});
