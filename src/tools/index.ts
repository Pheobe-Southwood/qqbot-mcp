import type { Config } from '../config.js';
import { INTENT_BITS, type IntentName } from '../config.js';
import type { Catalog } from '../catalog.js';
import type { QqBotClient } from '../client/http.js';
import { validateObjectAgainstSchema } from '../client/http.js';
import type { TokenManager } from '../client/token.js';
import type { MediaService, UploadResult } from '../client/media.js';
import { ToolError } from '../client/errors.js';
import type { EventStore } from '../events/store.js';
import type { GatewayClient } from '../events/gateway.js';
import type { WebhookServer } from '../events/webhook.js';
import type { AuditLogger } from '../safety/audit.js';
import { assertMode, requiredModeForTool } from '../safety/mode.js';
import type { Logger } from '../util/logger.js';
import type { ApiCallResult } from '../client/http.js';
import type { JsonSchema, MessageTarget, Mode, ToolDefinition, ToolResult } from '../types.js';
import { toolErrorPayload } from '../client/errors.js';

export interface Runtime {
  config: Config;
  catalog: Catalog;
  client: QqBotClient;
  tokenManager: TokenManager;
  store: EventStore;
  gateway: GatewayClient;
  webhook: WebhookServer;
  media: MediaService;
  audit: AuditLogger;
  logger: Logger;
}

type Args = Record<string, unknown>;
type Extra = { signal: AbortSignal };

const TARGET_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'Message target. c2c=user openid, group=group openid, channel=channel id, dm=dms guild id.',
  properties: {
    type: { type: 'string', enum: ['c2c', 'group', 'channel', 'dm'] },
    id: { type: 'string', minLength: 1 },
  },
  required: ['type', 'id'],
  additionalProperties: false,
};

const UPLOAD_TARGET_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['c2c', 'group'] },
    id: { type: 'string', minLength: 1 },
  },
  required: ['type', 'id'],
  additionalProperties: false,
};

const REFERENCE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    message_id: { type: 'string' },
    ignore_get_message_error: { type: 'boolean' },
  },
  additionalProperties: true,
};

const KEYBOARD_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    content: { type: 'object', additionalProperties: true },
  },
  additionalProperties: true,
};

const INTENTS_HELP = Object.keys(INTENT_BITS).join(', ');

const TOOLS: ToolDefinition[] = [
  {
    name: 'list_apis',
    description:
      'List QQ bot APIs from the local catalog (103 endpoints, 21 categories). Filter by category, keyword or read/write. This is the first call to discover what the bot can do.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Exact category name, e.g. 群聊消息 / 频道管理 / 素材管理.' },
        read_only: { type: 'boolean', description: 'true only read APIs, false only write APIs.' },
        include_legacy: { type: 'boolean', default: true, description: 'Include legacy/deprecated endpoints.' },
        keyword: { type: 'string', description: 'Substring match over name/aliases/summary/path.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'get_api',
    description:
      'Get the full documentation for one API: path/query/body schemas, response fields, error codes, rate limits and examples. Call this before invoke_api for non-trivial bodies.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'API name or alias, e.g. send_group_message.' } },
      required: ['name'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'search_apis',
    description: 'Search APIs by Chinese/English keywords and return ranked matches with method, path and read-only flag.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword, e.g. 撤回 / 禁言 / markdown / 上传.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'list_categories',
    description: 'List catalog categories with endpoint counts.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'list_event_types',
    description:
      'List QQ gateway/webhook event types (53), optionally filtered by intent or category. Use get_event_type for payload fields.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: { type: 'string', description: `Intent name (${INTENTS_HELP}) or bit value.` },
        category: { type: 'string' },
        keyword: { type: 'string' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'get_event_type',
    description: 'Get one event payload schema, required intents and examples (e.g. C2C_MESSAGE_CREATE, GROUP_AT_MESSAGE_CREATE).',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'bot_status',
    description:
      'Show local runtime status: mode, credential/token presence (never the token), catalog version, event buffer, gateway/webhook state. Optionally probe QQ with get_gateway_bot.',
    inputSchema: {
      type: 'object',
      properties: { probe_network: { type: 'boolean', default: false } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'query_api',
    description:
      'Call a read-only QQ API (GET endpoints such as get_gateway_bot, list_groups, get_group_member). Read mode or higher. For writes use invoke_api.',
    inputSchema: {
      type: 'object',
      properties: {
        api: { type: 'string', description: 'API name or alias.' },
        path: { type: 'object', additionalProperties: true, description: 'Path parameters, e.g. {"group_openid":"..."}.' },
        query: { type: 'object', additionalProperties: true, description: 'Query parameters.' },
        body: { type: 'object', additionalProperties: true, description: 'Body (rare for read APIs).' },
      },
      required: ['api'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'poll_events',
    description:
      'Read buffered gateway/webhook events. Consumes returned events by default; pass peek=true to keep them. Requires event transport to be running.',
    inputSchema: {
      type: 'object',
      properties: {
        types: { type: 'array', items: { type: 'string' }, description: 'Event types to include, e.g. ["C2C_MESSAGE_CREATE"].' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        peek: { type: 'boolean', default: false },
        since_seq: { type: 'integer', minimum: 0, description: 'Only events with seq greater than this.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'wait_events',
    description:
      'Long-poll for new events (default 30s, max 5min). Returns buffered matches immediately, otherwise waits for a gateway/webhook event. Cancelled when the client aborts.',
    inputSchema: {
      type: 'object',
      properties: {
        types: { type: 'array', items: { type: 'string' } },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        timeout_ms: { type: 'integer', minimum: 100, maximum: 300000, default: 30000 },
        peek: { type: 'boolean', default: false },
        since_seq: { type: 'integer', minimum: 0 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'clear_events',
    description: 'Drop all buffered events without stopping the transport. Useful after testing.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  {
    name: 'event_stream_status',
    description: 'Show event transport configuration plus gateway, webhook and buffer status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'download_attachment',
    description:
      'Download an attachment URL (message image/file, media URL) into QQBOT_MCP_DOWNLOAD_DIR with size cap and SSRF guard. Returns a local path for further processing.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        filename: { type: 'string' },
        max_bytes: { type: 'integer', minimum: 1 },
      },
      required: ['url'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'invoke_api',
    description:
      'Call any catalog API with explicit path/query/body. Write mode required. execution.file_path adds chunked rich-media upload for send_group_message/send_c2c_message/upload_* or multipart file_image for send_channel_message/send_dm_message.',
    inputSchema: {
      type: 'object',
      properties: {
        api: { type: 'string' },
        path: { type: 'object', additionalProperties: true },
        query: { type: 'object', additionalProperties: true },
        body: { type: 'object', additionalProperties: true },
        execution: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Local file inside QQBOT_MCP_UPLOAD_ROOT.' },
            file_type: { type: 'integer', enum: [1, 2, 3, 4] },
            srv_send_msg: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
      required: ['api'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  {
    name: 'send_message',
    description:
      'Send a message to c2c/group/channel/dm. Handles msg_type selection, local file upload (chunked rich media or multipart file_image), markdown, ark/embed/keyboard and passive replies via msg_id/event_id. Returns each API response.',
    inputSchema: {
      type: 'object',
      properties: {
        target: TARGET_SCHEMA,
        text: { type: 'string', description: 'Plain text content.' },
        markdown: {
          description: 'Markdown message: string or {content, custom_template_id?, params?}.',
          oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }],
        },
        file_path: { type: 'string', description: 'Local file inside QQBOT_MCP_UPLOAD_ROOT.' },
        file_url: { type: 'string', description: 'Public URL for rich media (c2c/group) or image URL (channel/dm).' },
        image_url: { type: 'string', description: 'Channel/DM image URL.' },
        ark: { type: 'object', additionalProperties: true },
        embed: { type: 'object', additionalProperties: true },
        keyboard: KEYBOARD_SCHEMA,
        message_reference: REFERENCE_SCHEMA,
        msg_id: { type: 'string', description: 'Passive reply: event message id.' },
        event_id: { type: 'string', description: 'Passive reply: event id (alternative to msg_id).' },
        msg_seq: { type: 'integer', minimum: 1, description: 'Reply sequence for the same msg_id; auto-increments for multi-part sends.' },
        input_notify: {
          type: 'object',
          properties: { input_type: { type: 'integer', enum: [1] }, input_second: { type: 'integer', minimum: 1, maximum: 60 } },
          required: ['input_type', 'input_second'],
          additionalProperties: false,
        },
        file_type: { type: 'integer', enum: [1, 2, 3, 4], description: 'Rich media type override.' },
      },
      required: ['target'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  {
    name: 'reply_message',
    description: 'Reply passively to an event. Same options as send_message but msg_id or event_id is required.',
    inputSchema: {
      type: 'object',
      properties: {
        target: TARGET_SCHEMA,
        msg_id: { type: 'string' },
        event_id: { type: 'string' },
        text: { type: 'string' },
        markdown: { oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }] },
        file_path: { type: 'string' },
        file_url: { type: 'string' },
        image_url: { type: 'string' },
        ark: { type: 'object', additionalProperties: true },
        embed: { type: 'object', additionalProperties: true },
        keyboard: KEYBOARD_SCHEMA,
        message_reference: REFERENCE_SCHEMA,
        msg_seq: { type: 'integer', minimum: 1 },
        input_notify: { type: 'object', additionalProperties: true },
        file_type: { type: 'integer', enum: [1, 2, 3, 4] },
      },
      required: ['target'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  {
    name: 'upload_media',
    description:
      'Upload rich media to c2c/group and return file_info; set srv_send_msg=true to send it immediately. markdown_image=true uploads a Markdown image (≤10MB) and returns qqbot-media:// URL.',
    inputSchema: {
      type: 'object',
      properties: {
        target: UPLOAD_TARGET_SCHEMA,
        file_path: { type: 'string' },
        file_url: { type: 'string' },
        file_type: { type: 'integer', enum: [1, 2, 3, 4] },
        srv_send_msg: { type: 'boolean', default: false },
        markdown_image: { type: 'boolean', default: false },
      },
      required: ['target'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'recall_message',
    description: 'Recall a message sent by the bot (c2c/group/channel/dm). Channel/DM support hidetip=true to hide the recall tip.',
    inputSchema: {
      type: 'object',
      properties: {
        target: TARGET_SCHEMA,
        message_id: { type: 'string' },
        hidetip: { type: 'boolean', default: false },
      },
      required: ['target', 'message_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  {
    name: 'start_event_stream',
    description:
      'Start receiving events. websocket uses the QQ gateway (one shard per process); webhook starts a local signed HTTP receiver. Write mode. Use event_stream_status / wait_events afterwards.',
    inputSchema: {
      type: 'object',
      properties: {
        transport: { type: 'string', enum: ['websocket', 'webhook'], default: 'websocket' },
        intents: {
          description: `Intent names array/string or bit mask. Names: ${INTENTS_HELP}.`,
          oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }, { type: 'integer' }],
        },
        shard: { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 2, maxItems: 2 },
        host: { type: 'string', description: 'Webhook bind host (default 127.0.0.1).' },
        port: { type: 'integer', minimum: 0, maximum: 65535 },
        path: { type: 'string' },
        wait_ready_ms: { type: 'integer', minimum: 0, maximum: 60000, default: 10000 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'stop_event_stream',
    description: 'Stop the gateway and webhook transports. Buffered events stay until cleared.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
];

export function allTools(): ToolDefinition[] {
  return TOOLS;
}

export function toolsForMode(mode: Mode): ToolDefinition[] {
  return TOOLS.filter((tool) => {
    const required = requiredModeForTool(tool.name);
    return !required || (mode === 'write' ? true : mode === 'read' ? required !== 'write' : required === 'docs');
  });
}

export async function callTool(runtime: Runtime, name: string, rawArgs: unknown, extra: Extra): Promise<ToolResult> {
  const args = isRecord(rawArgs) ? rawArgs : {};
  const started = Date.now();
  const required = requiredModeForTool(name);
  if (!required) {
    return errorResult(new ToolError(`Unknown tool "${name}".`));
  }
  try {
    assertMode(runtime.config.mode, required, name);
    const data = await route(runtime, name, args, extra);
    await runtime.audit.record({
      tool: name,
      api: typeof args.api === 'string' ? args.api : undefined,
      target: args.target,
      ok: true,
      duration_ms: Date.now() - started,
      body: args.body ?? args,
    });
    return okResult({ ok: true, ...data });
  } catch (error) {
    await runtime.audit.record({
      tool: name,
      api: typeof args.api === 'string' ? args.api : undefined,
      target: args.target,
      ok: false,
      duration_ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResult(error);
  }
}

async function route(runtime: Runtime, name: string, args: Args, extra: Extra): Promise<Record<string, unknown>> {
  switch (name) {
    case 'list_apis':
      return listApis(runtime, args);
    case 'get_api':
      return getApi(runtime, args);
    case 'search_apis':
      return searchApis(runtime, args);
    case 'list_categories':
      return { categories: runtime.catalog.categories() };
    case 'list_event_types':
      return listEventTypes(runtime, args);
    case 'get_event_type':
      return getEventType(runtime, args);
    case 'bot_status':
      return botStatus(runtime, args);
    case 'query_api':
      return queryApi(runtime, args);
    case 'poll_events':
      return pollEvents(runtime, args);
    case 'wait_events':
      return waitEvents(runtime, args, extra);
    case 'clear_events':
      return { cleared: runtime.store.clear() };
    case 'event_stream_status':
      return eventStreamStatus(runtime);
    case 'download_attachment':
      return downloadAttachment(runtime, args, extra);
    case 'invoke_api':
      return invokeApi(runtime, args, extra);
    case 'send_message':
      return sendMessage(runtime, args, extra);
    case 'reply_message':
      return replyMessage(runtime, args, extra);
    case 'upload_media':
      return uploadMedia(runtime, args, extra);
    case 'recall_message':
      return recallMessage(runtime, args);
    case 'start_event_stream':
      return startEventStream(runtime, args);
    case 'stop_event_stream':
      return stopEventStream(runtime);
    default:
      throw new ToolError(`Unknown tool "${name}".`);
  }
}

function listApis(runtime: Runtime, args: Args): Record<string, unknown> {
  const category = optionalString(args.category);
  const keyword = optionalString(args.keyword);
  const readOnly = optionalBoolean(args.read_only);
  const includeLegacy = optionalBoolean(args.include_legacy) ?? true;
  const apis = runtime.catalog.listApis({ category, keyword, readOnly, includeLegacy });
  return {
    count: apis.length,
    total: runtime.catalog.file.apiCount,
    categories: runtime.catalog.categories(),
    apis,
  };
}

function getApi(runtime: Runtime, args: Args): Record<string, unknown> {
  const name = requireString(args.name, 'name');
  const api = runtime.catalog.requireApi(name);
  return { api: runtime.catalog.apiDoc(api) };
}

function searchApis(runtime: Runtime, args: Args): Record<string, unknown> {
  const query = requireString(args.query, 'query');
  const limit = clamp(optionalInteger(args.limit) ?? 20, 1, 50);
  const hits = runtime.catalog.search(query, limit);
  return { query, count: hits.length, hits };
}

function listEventTypes(runtime: Runtime, args: Args): Record<string, unknown> {
  const intent = optionalString(args.intent);
  if (intent && !(intent in INTENT_BITS)) {
    throw new ToolError(`Unknown intent "${intent}".`, { hint: `Valid intents: ${INTENTS_HELP}` });
  }
  const events = runtime.catalog.listEvents({
    intent,
    category: optionalString(args.category),
    keyword: optionalString(args.keyword),
  });
  return { count: events.length, events };
}

function getEventType(runtime: Runtime, args: Args): Record<string, unknown> {
  const name = requireString(args.name, 'name');
  return { event: runtime.catalog.eventDoc(runtime.catalog.requireEvent(name)) };
}

async function botStatus(runtime: Runtime, args: Args): Promise<Record<string, unknown>> {
  const status: Record<string, unknown> = {
    mode: runtime.config.mode,
    credentials: runtime.tokenManager.status(),
    catalog: runtime.catalog.stats(),
    config: {
      api_base: runtime.config.apiBase,
      timeout_ms: runtime.config.timeoutMs,
      rate_limit: runtime.config.rateLimit,
      upload_root: runtime.config.uploadRoot ?? null,
      download_dir: runtime.config.downloadDir,
      max_upload_bytes: runtime.config.maxUploadBytes,
      event_transport: runtime.config.eventTransport,
      event_autostart: runtime.config.eventAutostart,
      intents: runtime.config.intents,
      shard: runtime.config.shard,
      audit_log: runtime.config.auditLog ?? null,
    },
    events: {
      transport: runtime.config.eventTransport,
      gateway: runtime.gateway.status(),
      webhook: runtime.webhook.status(),
      store: runtime.store.status(),
    },
  };
  if (args.probe_network === true && runtime.config.mode !== 'docs') {
    try {
      const probe = await runtime.client.call('get_gateway_bot');
      status.probe = { ok: true, data: probe.data, trace_id: probe.traceId ?? null };
    } catch (error) {
      status.probe = { ok: false, ...toolErrorPayload(error) };
    }
  }
  return status;
}

async function queryApi(runtime: Runtime, args: Args): Promise<Record<string, unknown>> {
  const api = runtime.catalog.requireApi(requireString(args.api, 'api'));
  if (!api.readOnly) {
    throw new ToolError(`${api.name} is a write API; use invoke_api (write mode).`, {
      hint: 'query_api only accepts read-only endpoints.',
    });
  }
  const path = optionalRecord(args.path);
  const query = optionalRecord(args.query);
  const body = optionalRecord(args.body);
  validateObjectAgainstSchema(path, api.pathSchema, 'path');
  validateObjectAgainstSchema(query, api.querySchema, 'query');
  validateObjectAgainstSchema(body, api.bodySchema, 'body');
  const result = await runtime.client.request(api, { path, query, body });
  return apiResult(api.name, result);
}

function pollEvents(runtime: Runtime, args: Args): Record<string, unknown> {
  ensureTransport(runtime.config.eventTransport, runtime.config.eventAutostart, runtime.gateway.status(), runtime.webhook.status());
  const result = runtime.store.poll({
    types: optionalStringArray(args.types),
    limit: optionalInteger(args.limit),
    peek: optionalBoolean(args.peek),
    sinceSeq: optionalInteger(args.since_seq),
  });
  return {
    transport: runtime.config.eventTransport,
    count: result.events.length,
    ...result,
    gateway_state: runtime.gateway.status().state,
    hint: result.events.length === 0 ? 'No matching events buffered. Use wait_events to wait for the next event.' : undefined,
  };
}

async function waitEvents(runtime: Runtime, args: Args, extra: Extra): Promise<Record<string, unknown>> {
  ensureTransport(runtime.config.eventTransport, runtime.config.eventAutostart, runtime.gateway.status(), runtime.webhook.status());
  const timeoutMs = clamp(optionalInteger(args.timeout_ms) ?? 30_000, 100, 300_000);
  const result = await runtime.store.wait({
    types: optionalStringArray(args.types),
    limit: optionalInteger(args.limit),
    peek: optionalBoolean(args.peek),
    sinceSeq: optionalInteger(args.since_seq),
    timeoutMs,
    signal: extra.signal,
  });
  return {
    transport: runtime.config.eventTransport,
    count: result.events.length,
    ...result,
    hint: result.timed_out ? 'Timed out. Check event_stream_status; the bot may not be receiving events.' : undefined,
  };
}

function eventStreamStatus(runtime: Runtime): Record<string, unknown> {
  return {
    transport: runtime.config.eventTransport,
    autostart: runtime.config.eventAutostart,
    intents: runtime.config.intents,
    shard: runtime.config.shard,
    gateway: runtime.gateway.status(),
    webhook: runtime.webhook.status(),
    store: runtime.store.status(),
  };
}

async function downloadAttachment(runtime: Runtime, args: Args, extra: Extra): Promise<Record<string, unknown>> {
  const url = requireString(args.url, 'url');
  const data = await runtime.media.download(url, {
    filename: optionalString(args.filename),
    maxBytes: optionalInteger(args.max_bytes),
    signal: extra.signal,
  });
  return data;
}

async function invokeApi(runtime: Runtime, args: Args, extra: Extra): Promise<Record<string, unknown>> {
  const api = runtime.catalog.requireApi(requireString(args.api, 'api'));
  const path = optionalRecord(args.path);
  const query = optionalRecord(args.query);
  const body = optionalRecord(args.body) ?? {};
  const execution = optionalRecord(args.execution) ?? {};
  const filePath = optionalString(execution.file_path);
  validateObjectAgainstSchema(path, api.pathSchema, 'path');
  validateObjectAgainstSchema(query, api.querySchema, 'query');

  if (!filePath) {
    validateObjectAgainstSchema(body, api.bodySchema, 'body');
    const result = await runtime.client.request(api, { path, query, body: Object.keys(body).length > 0 ? body : undefined });
    return apiResult(api.name, result);
  }

  const fileType = optionalInteger(execution.file_type);
  const srvSendMsg = optionalBoolean(execution.srv_send_msg);
  if (api.name === 'upload_group_file' || api.name === 'upload_c2c_file') {
    const scene = api.name === 'upload_group_file' ? 'group' : 'c2c';
    const targetId = path[scene === 'group' ? 'group_openid' : 'user_openid'];
    if (!targetId) throw new ToolError(`Missing path.${scene === 'group' ? 'group_openid' : 'user_openid'}.`);
    const upload = await runtime.media.uploadLocal({
      scene,
      targetId: String(targetId),
      filePath,
      fileType,
      srvSendMsg,
      signal: extra.signal,
    });
    return { api: api.name, upload };
  }

  if (api.name === 'send_group_message' || api.name === 'send_c2c_message') {
    const scene = api.name === 'send_group_message' ? 'group' : 'c2c';
    const param = scene === 'group' ? 'group_openid' : 'user_openid';
    const targetId = path[param];
    if (!targetId) throw new ToolError(`Missing path.${param}.`);
    const upload = await runtime.media.uploadLocal({
      scene,
      targetId: String(targetId),
      filePath,
      fileType,
      signal: extra.signal,
    });
    const merged = { ...body, msg_type: 7, media: { file_info: upload.file_info } };
    validateObjectAgainstSchema(merged, api.bodySchema, 'body');
    const result = await runtime.client.request(api, {
      path,
      query,
      body: merged,
    });
    return { api: api.name, upload, ...apiResultData(result) };
  }

  if (api.name === 'send_channel_message' || api.name === 'send_dm_message') {
    validateObjectAgainstSchema(body, api.bodySchema, 'body');
    const image = await runtime.media.readChannelImage(filePath);
    const result = await runtime.client.requestMultipart(
      api,
      { field: 'file_image', filename: image.filename, contentType: image.contentType, data: image.data },
      body,
      { path, query },
    );
    return { api: api.name, file: { name: image.filename, size: image.size }, ...apiResultData(result) };
  }

  throw new ToolError(`execution.file_path is not supported for ${api.name}.`, {
    hint: 'Local uploads work with upload_group_file/upload_c2c_file, send_group_message/send_c2c_message and send_channel_message/send_dm_message.',
  });
}

async function sendMessage(runtime: Runtime, args: Args, extra: Extra): Promise<Record<string, unknown>> {
  const target = parseTarget(args.target);
  const text = optionalString(args.text);
  const markdown = args.markdown;
  const filePath = optionalString(args.file_path);
  const fileUrl = optionalString(args.file_url);
  const imageUrl = optionalString(args.image_url);
  const msgId = optionalString(args.msg_id);
  const eventId = optionalString(args.event_id);
  const fileType = optionalInteger(args.file_type);
  const inputNotify = args.input_notify === undefined ? undefined : optionalRecord(args.input_notify);

  if (target.type === 'c2c' || target.type === 'group') {
    return sendC2cOrGroup(runtime, {
      target,
      text,
      markdown,
      filePath,
      fileUrl,
      msgId,
      eventId,
      fileType,
      inputNotify,
      signal: extra.signal,
      args,
    });
  }
  return sendChannelOrDm(runtime, { target, text, markdown, filePath, fileUrl, imageUrl, msgId, eventId, args, signal: extra.signal });
}

interface SendPart {
  api: string;
  data: unknown;
  trace_id?: string;
  http_status?: number;
}

async function sendC2cOrGroup(
  runtime: Runtime,
  input: {
    target: MessageTarget;
    text?: string;
    markdown?: unknown;
    filePath?: string;
    fileUrl?: string;
    msgId?: string;
    eventId?: string;
    fileType?: number;
    inputNotify?: Record<string, unknown>;
    signal: AbortSignal;
    args: Args;
  },
): Promise<Record<string, unknown>> {
  const scene = input.target.type as 'c2c' | 'group';
  const apiName = scene === 'group' ? 'send_group_message' : 'send_c2c_message';
  const pathParam = scene === 'group' ? 'group_openid' : 'user_openid';
  const api = runtime.catalog.requireApi(apiName);
  const hasMedia = Boolean(input.filePath || input.fileUrl);
  if (!hasMedia && !input.text && input.markdown === undefined && !input.inputNotify) {
    throw new ToolError('send_message needs text, markdown, input_notify or file_path/file_url.');
  }
  if (input.args.ark !== undefined || input.args.embed !== undefined || input.args.image_url !== undefined) {
    throw new ToolError('ark/embed/image_url are channel-only; C2C/group messages support text, markdown, keyboard, media and message_reference.');
  }
  if (input.text && input.markdown !== undefined) {
    throw new ToolError('Use either text or markdown, not both.');
  }
  if (input.inputNotify && (hasMedia || input.text || input.markdown !== undefined)) {
    throw new ToolError('input_notify is a standalone msg_type=6 message; send it separately from text/markdown/media.');
  }
  const extras: Record<string, unknown> = {};
  if (input.args.keyboard !== undefined) extras.keyboard = input.args.keyboard;
  if (input.args.message_reference !== undefined) extras.message_reference = input.args.message_reference;

  let upload: UploadResult | undefined;
  if (hasMedia) {
    upload = input.filePath
      ? await runtime.media.uploadLocal({
          scene,
          targetId: input.target.id,
          filePath: input.filePath,
          fileType: input.fileType,
          signal: input.signal,
        })
      : await runtime.media.uploadUrl({
          scene,
          targetId: input.target.id,
          url: input.fileUrl!,
          fileType: input.fileType,
          signal: input.signal,
        });
  }

  const sent: SendPart[] = [];
  let sequence = optionalInteger(input.args.msg_seq) ?? 1;
  const baseReply = {
    ...(input.msgId ? { msg_id: input.msgId } : {}),
    ...(input.eventId ? { event_id: input.eventId } : {}),
    ...(input.msgId || input.eventId ? { msg_seq: sequence } : {}),
  };

  if (upload) {
    const body = { msg_type: 7, media: { file_info: upload.file_info }, ...baseReply };
    const result = await runtime.client.request(api, { path: { [pathParam]: input.target.id }, body });
    sent.push(toSendPart(apiName, result));
    if (input.text || input.markdown !== undefined) sequence += 1;
  }
  if (input.text) {
    const body = { msg_type: 0, content: input.text, ...baseReply, ...(baseReply.msg_seq ? { msg_seq: sequence } : {}), ...extras };
    const result = await runtime.client.request(api, { path: { [pathParam]: input.target.id }, body });
    sent.push(toSendPart(apiName, result));
  } else if (input.markdown !== undefined) {
    const body = { msg_type: 2, markdown: normalizeMarkdown(input.markdown), ...baseReply, ...(baseReply.msg_seq ? { msg_seq: sequence } : {}), ...extras };
    const result = await runtime.client.request(api, { path: { [pathParam]: input.target.id }, body });
    sent.push(toSendPart(apiName, result));
  } else if (!upload && input.inputNotify) {
    const body = { msg_type: 6, input_notify: input.inputNotify, ...baseReply, ...extras };
    const result = await runtime.client.request(api, { path: { [pathParam]: input.target.id }, body });
    sent.push(toSendPart(apiName, result));
  }
  return {
    target: input.target,
    sent,
    ...(upload ? { upload } : {}),
  };
}

async function sendChannelOrDm(
  runtime: Runtime,
  input: {
    target: MessageTarget;
    text?: string;
    markdown?: unknown;
    filePath?: string;
    fileUrl?: string;
    imageUrl?: string;
    msgId?: string;
    eventId?: string;
    signal: AbortSignal;
    args: Args;
  },
): Promise<Record<string, unknown>> {
  const isDm = input.target.type === 'dm';
  const apiName = isDm ? 'send_dm_message' : 'send_channel_message';
  const pathParam = isDm ? 'guild_id' : 'channel_id';
  const api = runtime.catalog.requireApi(apiName);
  const body: Record<string, unknown> = {};
  if (input.text && input.markdown !== undefined) {
    throw new ToolError('Use either text or markdown, not both.');
  }
  if (input.text) body.content = input.text;
  if (input.markdown !== undefined) body.markdown = normalizeMarkdown(input.markdown);
  for (const key of ['ark', 'embed', 'keyboard', 'message_reference'] as const) {
    const value = input.args[key];
    if (value !== undefined) body[key] = value;
  }
  if (input.imageUrl) body.image = input.imageUrl;
  else if (input.fileUrl && !input.filePath) body.image = input.fileUrl;
  if (input.msgId) body.msg_id = input.msgId;
  if (input.eventId) body.event_id = input.eventId;

  if (!input.filePath && !input.fileUrl && !input.imageUrl && !input.text && input.markdown === undefined && !body.ark && !body.embed) {
    throw new ToolError('Channel/DM messages need content, markdown, ark, embed, image_url or file_path.');
  }

  let file: { name: string; size: number } | undefined;
  let result: ApiCallResult;
  if (input.filePath) {
    const image = await runtime.media.readChannelImage(input.filePath);
    result = await runtime.client.requestMultipart(
      api,
      { field: 'file_image', filename: image.filename, contentType: image.contentType, data: image.data },
      body,
      { path: { [pathParam]: input.target.id } },
    );
    file = { name: image.filename, size: image.size };
  } else {
    result = await runtime.client.request(api, { path: { [pathParam]: input.target.id }, body });
  }
  return {
    target: input.target,
    sent: [toSendPart(apiName, result)],
    ...(file ? { file } : {}),
  };
}

async function replyMessage(runtime: Runtime, args: Args, extra: Extra): Promise<Record<string, unknown>> {
  if (!optionalString(args.msg_id) && !optionalString(args.event_id)) {
    throw new ToolError('reply_message requires msg_id or event_id from the event payload.', {
      hint: 'For C2C/group passive replies both are accepted; channel messages usually use msg_id.',
    });
  }
  return sendMessage(runtime, args, extra);
}

async function uploadMedia(runtime: Runtime, args: Args, extra: Extra): Promise<Record<string, unknown>> {
  const target = parseTarget(args.target);
  if (target.type !== 'c2c' && target.type !== 'group') {
    throw new ToolError('upload_media supports c2c and group targets only.');
  }
  const filePath = optionalString(args.file_path);
  const fileUrl = optionalString(args.file_url);
  const fileType = optionalInteger(args.file_type);
  const srvSendMsg = optionalBoolean(args.srv_send_msg);
  if (args.markdown_image === true) {
    if (!filePath) throw new ToolError('markdown_image uploads require file_path.');
    const result = await runtime.media.uploadMarkdownImage(filePath, extra.signal);
    return { target, markdown_image: result };
  }
  if (!filePath && !fileUrl) throw new ToolError('upload_media needs file_path or file_url.');
  const upload = filePath
    ? await runtime.media.uploadLocal({ scene: target.type, targetId: target.id, filePath, fileType, srvSendMsg, signal: extra.signal })
    : await runtime.media.uploadUrl({ scene: target.type, targetId: target.id, url: fileUrl!, fileType, srvSendMsg, signal: extra.signal });
  return { target, upload };
}

async function recallMessage(runtime: Runtime, args: Args): Promise<Record<string, unknown>> {
  const target = parseTarget(args.target);
  const messageId = requireString(args.message_id, 'message_id');
  const hidetip = optionalBoolean(args.hidetip) ?? false;
  const mapping = {
    c2c: { api: 'recall_c2c_message', param: 'user_openid' },
    group: { api: 'recall_group_message', param: 'group_openid' },
    channel: { api: 'recall_channel_message', param: 'channel_id' },
    dm: { api: 'recall_dm_message', param: 'guild_id' },
  } as const;
  const entry = mapping[target.type];
  const api = runtime.catalog.requireApi(entry.api);
  const query = (target.type === 'channel' || target.type === 'dm') && hidetip ? { hidetip: true } : undefined;
  const result = await runtime.client.request(api, { path: { [entry.param]: target.id, message_id: messageId }, query });
  return { target, message_id: messageId, api: entry.api, ...apiResultData(result) };
}

async function startEventStream(runtime: Runtime, args: Args): Promise<Record<string, unknown>> {
  const transport = optionalString(args.transport) ?? (runtime.config.eventTransport !== 'off' ? runtime.config.eventTransport : 'websocket');
  if (transport !== 'websocket' && transport !== 'webhook') {
    throw new ToolError('transport must be websocket or webhook.');
  }
  if (transport === 'websocket') {
    await runtime.webhook.stop();
    const intents = args.intents === undefined ? undefined : parseIntents(args.intents);
    const shard = parseShard(args.shard);
    const gateway = await runtime.gateway.start({
      intents,
      shard,
      waitReadyMs: clamp(optionalInteger(args.wait_ready_ms) ?? 10_000, 0, 60_000),
    });
    runtime.config.eventTransport = 'websocket';
    return { transport, gateway };
  }
  await runtime.gateway.stop();
  const webhook = await runtime.webhook.start({
    host: optionalString(args.host),
    port: optionalInteger(args.port),
    path: optionalString(args.path),
  });
  runtime.config.eventTransport = 'webhook';
  return { transport, webhook };
}

async function stopEventStream(runtime: Runtime): Promise<Record<string, unknown>> {
  const gateway = await runtime.gateway.stop();
  const webhook = await runtime.webhook.stop();
  runtime.config.eventTransport = 'off';
  return { gateway, webhook, buffered: runtime.store.status().buffered };
}

function parseTarget(raw: unknown): MessageTarget {
  const target = optionalRecord(raw);
  const type = requireString(target.type, 'target.type').toLowerCase();
  const id = requireString(target.id, 'target.id');
  if (!['c2c', 'group', 'channel', 'dm'].includes(type)) {
    throw new ToolError(`target.type must be c2c, group, channel or dm; got "${type}".`);
  }
  return { type: type as MessageTarget['type'], id };
}

function normalizeMarkdown(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return { content: value };
  const record = optionalRecord(value);
  if (typeof record.content !== 'string' || record.content.length === 0) throw new ToolError('markdown object must include a non-empty string content.');
  return record;
}

function apiResult(name: string, result: ApiCallResult): Record<string, unknown> {
  return { api: name, ...apiResultData(result) };
}

function apiResultData(result: ApiCallResult): Record<string, unknown> {
  return {
    http_status: result.httpStatus,
    ...(result.traceId ? { trace_id: result.traceId } : {}),
    ...(result.pendingAudit ? { pending_audit: true } : {}),
    data: result.data,
  };
}

function toSendPart(api: string, result: ApiCallResult): SendPart {
  return {
    api,
    data: result.data,
    http_status: result.httpStatus,
    ...(result.traceId ? { trace_id: result.traceId } : {}),
  };
}

function ensureTransport(
  transport: string,
  autostart: boolean,
  gatewayStatus: Record<string, unknown>,
  webhookStatus: Record<string, unknown>,
): void {
  if (transport === 'websocket' && gatewayStatus.state !== 'ready') {
    throw new ToolError(`Event transport is websocket but the gateway is ${String(gatewayStatus.state)}.`, {
      hint: autostart
        ? 'Check event_stream_status for gateway errors.'
        : 'Start it with start_event_stream (write mode) or set QQBOT_MCP_EVENT_TRANSPORT=websocket and QQBOT_MCP_EVENT_AUTOSTART=true.',
    });
  }
  if (transport === 'webhook' && webhookStatus.listening !== true) {
    throw new ToolError('Event transport is webhook but the receiver is not listening.', {
      hint: 'Start it with start_event_stream, or configure QQBOT_MCP_EVENT_AUTOSTART=true.',
    });
  }
  if (transport === 'off') {
    throw new ToolError('Event transport is off.', {
      hint: 'Set QQBOT_MCP_EVENT_TRANSPORT=websocket|webhook and restart, or call start_event_stream (write mode).',
    });
  }
}

function parseIntents(raw: unknown): number {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw;
  if (Array.isArray(raw)) {
    let bits = 0;
    for (const item of raw) {
      if (typeof item !== 'string') throw new ToolError('intents array must contain intent names.');
      bits |= intentBit(item);
    }
    return bits;
  }
  if (typeof raw === 'string') {
    if (/^\d+$/.test(raw.trim())) return Number(raw.trim());
    let bits = 0;
    for (const name of raw.split(/[,\s|+]+/).filter(Boolean)) {
      bits |= intentBit(name);
    }
    return bits;
  }
  throw new ToolError('intents must be an array of names, a comma-separated string, or a bit mask.');
}

function intentBit(name: string): number {
  if (name.toLowerCase() === 'all') {
    return Object.values(INTENT_BITS).reduce((sum, bit) => sum | bit, 0);
  }
  const normalized = name.toUpperCase();
  if (!(normalized in INTENT_BITS)) {
    throw new ToolError(`Unknown intent "${name}".`, { hint: `Valid intents: ${INTENTS_HELP}` });
  }
  return INTENT_BITS[normalized as IntentName];
}

function parseShard(raw: unknown): [number, number] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length !== 2) throw new ToolError('shard must be [id, count].');
  const [id, count] = raw.map(Number);
  if (!Number.isInteger(id) || !Number.isInteger(count) || id! < 0 || count! < 1 || id! >= count!) {
    throw new ToolError('shard must satisfy 0 <= id < count.');
  }
  return [id!, count!];
}

function okResult(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(error: unknown): ToolResult {
  const payload = { ok: false, ...toolErrorPayload(error) };
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new ToolError('Expected an object argument.');
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolError(`${label} is required and must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ToolError('Expected a string argument.');
  return value.trim() || undefined;
}

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number)) throw new ToolError('Expected an integer argument.');
  return number;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new ToolError('Expected a boolean argument.');
  return value;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ToolError('Expected an array of strings.');
  }
  return value.map((item) => item.toUpperCase());
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
