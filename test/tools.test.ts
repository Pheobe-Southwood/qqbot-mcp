import { describe, expect, it, vi } from 'vitest';
import { Catalog } from '../src/catalog.js';
import { EventStore } from '../src/events/store.js';
import { resolveConfig, type Config } from '../src/config.js';
import { Logger } from '../src/util/logger.js';
import { AuditLogger } from '../src/safety/audit.js';
import { callTool, toolsForMode, type Runtime } from '../src/tools/index.js';
import type { QqBotClient } from '../src/client/http.js';
import type { MediaService } from '../src/client/media.js';
import type { ApiCallResult } from '../src/client/http.js';

const catalog = Catalog.load();
const logger = new Logger('error');

function baseConfig(mode: Config['mode']): Config {
  return {
    ...resolveConfig({ QQBOT_ACCESS_TOKEN: 'tok', QQBOT_MCP_MODE: mode }).config,
    mode,
    rateLimit: false,
  };
}

interface Fake {
  runtime: Runtime;
  requests: Array<{ api: string; path?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown }>;
  multipart: Array<{ api: string; fields: Record<string, unknown> }>;
  media: {
    uploadLocal: ReturnType<typeof vi.fn>;
    uploadUrl: ReturnType<typeof vi.fn>;
    uploadMarkdownImage: ReturnType<typeof vi.fn>;
    readChannelImage: ReturnType<typeof vi.fn>;
  };
}

function fakeRuntime(mode: Config['mode'] = 'write'): Fake {
  const requests: Fake['requests'] = [];
  const multipart: Fake['multipart'] = [];
  const client = {
    request: vi.fn(async (api: { name: string }, options: { path?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown }) => {
      requests.push({ api: api.name, ...options });
      return { ok: true, httpStatus: 200, data: { id: `MSG-${requests.length}` }, url: 'https://api.test' } satisfies ApiCallResult;
    }),
    requestMultipart: vi.fn(async (api: { name: string }, _file: unknown, fields: Record<string, unknown>) => {
      multipart.push({ api: api.name, fields });
      return { ok: true, httpStatus: 200, data: { id: 'CHANNEL-MSG' }, url: 'https://api.test' } satisfies ApiCallResult;
    }),
    call: vi.fn(),
  } as unknown as QqBotClient;
  const media = {
    uploadLocal: vi.fn(async () => ({
      ok: true,
      scene: 'group',
      target_id: 'G',
      file_name: 'a.bin',
      file_size: 10,
      file_type: 4,
      file_type_label: 'file',
      file_info: 'FILE-INFO',
      upload: {},
    })),
    uploadUrl: vi.fn(async () => ({
      ok: true,
      scene: 'group',
      target_id: 'G',
      file_name: '',
      file_size: 0,
      file_type: 4,
      file_type_label: 'file',
      file_info: 'URL-FILE-INFO',
      upload: {},
    })),
    uploadMarkdownImage: vi.fn(async () => ({ ok: true, image_id: 'IMG', url: 'qqbot-media://image/v1/x' })),
    readChannelImage: vi.fn(async () => ({
      data: Buffer.from('img'),
      filename: 'a.png',
      contentType: 'image/png',
      size: 3,
    })),
  };
  const runtime: Runtime = {
    config: baseConfig(mode),
    catalog,
    client,
    tokenManager: {
      status: () => ({ configured: true, source: 'static', expiresAt: null, valid: true }),
    } as unknown as Runtime['tokenManager'],
    store: new EventStore({ capacity: 10, ttlMs: 60_000 }),
    gateway: {
      status: () => ({ state: 'idle' }),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as Runtime['gateway'],
    webhook: {
      status: () => ({ listening: false }),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as Runtime['webhook'],
    media: media as unknown as MediaService,
    audit: new AuditLogger(undefined, false, logger),
    logger,
  };
  return { runtime, requests, multipart, media };
}

function textOf(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

const extra = { signal: new AbortController().signal };

describe('tool surface', () => {
  it('exposes docs, read and write tools according to mode', () => {
    expect(toolsForMode('docs').map((tool) => tool.name)).toHaveLength(7);
    expect(toolsForMode('read').map((tool) => tool.name)).toHaveLength(13);
    expect(toolsForMode('write').map((tool) => tool.name)).toHaveLength(20);
    expect(toolsForMode('docs').some((tool) => tool.name === 'invoke_api')).toBe(false);
    expect(toolsForMode('read').some((tool) => tool.name === 'send_message')).toBe(false);
    expect(toolsForMode('write').some((tool) => tool.name === 'send_message')).toBe(true);
  });

  it('rejects a read tool in docs mode with an actionable error', async () => {
    const { runtime } = fakeRuntime('docs');
    const result = await callTool(runtime, 'query_api', { api: 'get_gateway_bot' }, extra);
    expect(result.isError).toBe(true);
    expect(textOf(result).error).toMatchObject({ message: expect.stringContaining('requires read mode') });
  });

  it('lists all APIs and supports keyword filters', async () => {
    const { runtime } = fakeRuntime('docs');
    const all = textOf(await callTool(runtime, 'list_apis', {}, extra));
    expect(all.count).toBe(103);
    const filtered = textOf(await callTool(runtime, 'list_apis', { category: '群聊消息' }, extra));
    expect(filtered.count).toBeGreaterThan(0);
    expect((filtered.apis as Array<{ category: string }>).every((api) => api.category === '群聊消息')).toBe(true);
  });

  it('returns a helpful error for unknown APIs', async () => {
    const { runtime } = fakeRuntime('docs');
    const result = await callTool(runtime, 'get_api', { name: 'send_grup_message' }, extra);
    expect(result.isError).toBe(true);
    expect(textOf(result).error).toMatchObject({ message: expect.stringContaining('Unknown API') });
  });
});

describe('query_api', () => {
  it('calls read-only APIs and returns data + trace', async () => {
    const { runtime, requests } = fakeRuntime('read');
    const result = await callTool(runtime, 'query_api', { api: 'get_gateway_bot' }, extra);
    expect(result.isError).toBeUndefined();
    expect(requests[0]).toMatchObject({ api: 'get_gateway_bot' });
    expect(textOf(result)).toMatchObject({ ok: true, api: 'get_gateway_bot', data: { id: 'MSG-1' } });
  });

  it('refuses to call a write API', async () => {
    const { runtime } = fakeRuntime('read');
    const result = await callTool(
      runtime,
      'query_api',
      { api: 'send_group_message', path: { group_openid: 'g' }, body: { msg_type: 0, content: 'hi' } },
      extra,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result).error).toMatchObject({ message: expect.stringContaining('write API') });
  });
});

describe('send_message', () => {
  it('sends plain text to a group', async () => {
    const { runtime, requests } = fakeRuntime();
    const result = await callTool(
      runtime,
      'send_message',
      { target: { type: 'group', id: 'GROUP' }, text: 'hello' },
      extra,
    );
    expect(result.isError).toBeUndefined();
    expect(requests[0]).toMatchObject({
      api: 'send_group_message',
      path: { group_openid: 'GROUP' },
      body: { msg_type: 0, content: 'hello' },
    });
    expect(textOf(result).sent).toHaveLength(1);
  });

  it('sends markdown to C2C with an incremented msg_seq', async () => {
    const { runtime, requests } = fakeRuntime();
    await callTool(
      runtime,
      'send_message',
      { target: { type: 'c2c', id: 'USER' }, msg_id: 'EVT-MSG', markdown: '**hi**' },
      extra,
    );
    expect(requests[0]).toMatchObject({
      api: 'send_c2c_message',
      body: { msg_type: 2, markdown: { content: '**hi**' }, msg_id: 'EVT-MSG', msg_seq: 1 },
    });
  });

  it('uploads a local file then sends media and text as two parts', async () => {
    const { runtime, requests, media } = fakeRuntime();
    const result = await callTool(
      runtime,
      'send_message',
      {
        target: { type: 'group', id: 'GROUP' },
        msg_id: 'EVT-MSG',
        file_path: 'a.bin',
        text: 'caption',
      },
      extra,
    );
    expect(media.uploadLocal).toHaveBeenCalledWith(
      expect.objectContaining({ scene: 'group', targetId: 'GROUP', filePath: 'a.bin' }),
    );
    expect(requests).toHaveLength(2);
    expect(requests[0]!.body).toMatchObject({
      msg_type: 7,
      media: { file_info: 'FILE-INFO' },
      msg_id: 'EVT-MSG',
      msg_seq: 1,
    });
    expect(requests[1]!.body).toMatchObject({ msg_type: 0, content: 'caption', msg_seq: 2 });
    expect(result.isError).toBeUndefined();
  });

  it('sends a channel message with multipart file_image', async () => {
    const { runtime, multipart } = fakeRuntime();
    const result = await callTool(
      runtime,
      'send_message',
      { target: { type: 'channel', id: 'CHAN' }, file_path: 'a.png', text: 'look' },
      extra,
    );
    expect(result.isError).toBeUndefined();
    expect(multipart[0]).toMatchObject({ api: 'send_channel_message', fields: { content: 'look' } });
  });

  it('requires msg_id or event_id for reply_message', async () => {
    const { runtime } = fakeRuntime();
    const result = await callTool(
      runtime,
      'reply_message',
      { target: { type: 'group', id: 'G' }, text: 'hi' },
      extra,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result).error).toMatchObject({ message: expect.stringContaining('msg_id or event_id') });
  });
});

describe('recall and upload helpers', () => {
  it('routes recalls to the scene-specific endpoint', async () => {
    const { runtime, requests } = fakeRuntime();
    await callTool(runtime, 'recall_message', { target: { type: 'c2c', id: 'U' }, message_id: 'M' }, extra);
    expect(requests[0]).toMatchObject({ api: 'recall_c2c_message', path: { user_openid: 'U', message_id: 'M' } });
  });

  it('uploads markdown images through the media service', async () => {
    const { runtime, media } = fakeRuntime();
    const result = await callTool(
      runtime,
      'upload_media',
      { target: { type: 'group', id: 'G' }, file_path: 'pic.png', markdown_image: true },
      extra,
    );
    expect(media.uploadMarkdownImage).toHaveBeenCalledWith('pic.png', expect.anything());
    expect(textOf(result).markdown_image).toMatchObject({ image_id: 'IMG' });
  });
});

describe('events tools', () => {
  it('switches the runtime transport when starting a stream', async () => {
    const { runtime } = fakeRuntime('write');
    (runtime.gateway.start as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ state: 'ready' });
    const result = await callTool(
      runtime,
      'start_event_stream',
      { transport: 'websocket', intents: ['GROUP_AND_C2C_EVENT'], shard: [0, 1] },
      extra,
    );
    expect(result.isError).toBeUndefined();
    expect(runtime.config.eventTransport).toBe('websocket');
    expect(runtime.gateway.start).toHaveBeenCalledWith(
      expect.objectContaining({ intents: expect.any(Number), shard: [0, 1] }),
    );
    await callTool(runtime, 'stop_event_stream', {}, extra);
    expect(runtime.config.eventTransport).toBe('off');
  });

  it('explains that events are off instead of hanging', async () => {
    const { runtime } = fakeRuntime('read');
    const result = await callTool(runtime, 'poll_events', {}, extra);
    expect(result.isError).toBe(true);
    expect(textOf(result).error).toMatchObject({ message: expect.stringContaining('Event transport is off') });
  });
});
