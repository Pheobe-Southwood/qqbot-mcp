import type { Runtime } from '../tools/index.js';
import { callTool } from '../tools/index.js';
import type { ToolResult } from '../types.js';
import { formatQr, generateQr, resolveQrUrl } from './qr.js';
import { helpText } from './args.js';

export interface CliIO {
  write(text: string): void;
  error(text: string): void;
  ask(prompt: string): Promise<string>;
}

export type CommandOutcome = 'continue' | 'exit';

const ALIASES: Record<string, string> = {
  帮助: 'help',
  状态: 'status',
  二维码: 'qr',
  接口: 'apis',
  配置: 'config',
  发消息: 'send',
  回复: 'reply',
  事件: 'events',
  退出: 'exit',
};

const PACKAGE_NAME = 'qqbot-mcp';

export function splitArgs(line: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return tokens;
}

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseToolResult(result: ToolResult): Record<string, unknown> {
  const text = result.content[0]?.text ?? '{}';
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : { value: parsed };
  } catch {
    return { text };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorText(data: Record<string, unknown>): string {
  const error = isRecord(data.error) ? data.error : {};
  const message = typeof error.message === 'string' ? error.message : JSON.stringify(data);
  const hint = typeof error.hint === 'string' && error.hint ? `\n提示：${error.hint}` : '';
  const code = error.err_code === undefined ? '' : `\n错误码：${String(error.err_code)}`;
  return `错误：${message}${code}${hint}\n`;
}

async function runTool(
  runtime: Runtime,
  name: string,
  args: Record<string, unknown>,
  io: CliIO,
): Promise<Record<string, unknown> | undefined> {
  const result = await callTool(runtime, name, args, { signal: new AbortController().signal });
  const data = parseToolResult(result);
  if (result.isError) {
    io.error(errorText(data));
    return undefined;
  }
  return data;
}

async function askRequired(io: CliIO, prompt: string): Promise<string> {
  const value = (await io.ask(prompt)).trim();
  if (!value) throw new Error('该项不能为空。');
  return value;
}

function safeConfig(runtime: Runtime): Record<string, unknown> {
  return {
    mode: runtime.config.mode,
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
  };
}

function mcpConfig(): Record<string, unknown> {
  return {
    mcpServers: {
      qqbot: {
        command: 'npx',
        args: ['-y', PACKAGE_NAME, '--mcp'],
        env: {
          QQBOT_APP_ID: '102xxxxxx',
          QQBOT_APP_SECRET: 'replace-me',
          QQBOT_MCP_MODE: 'read',
          QQBOT_MCP_UPLOAD_ROOT: '/srv/qqbot-files',
        },
      },
    },
  };
}

async function sendWizard(runtime: Runtime, io: CliIO, tokens: string[]): Promise<void> {
  let type = tokens[0];
  let id = tokens[1];
  let text = tokens.slice(2).join(' ');
  if (!type) type = await io.ask('目标类型（c2c/group/channel/dm）：');
  type = type.trim().toLowerCase();
  if (!['c2c', 'group', 'channel', 'dm'].includes(type)) throw new Error('目标类型必须是 c2c/group/channel/dm。');
  if (!id) id = await askRequired(io, '目标 ID：');
  const quick = Boolean(text.trim());

  let filePath = '';
  let msgId = '';
  if (!quick) {
    text = await io.ask('文本（可留空）：');
    filePath = (await io.ask('本地文件路径（可留空）：')).trim();
    msgId = (await io.ask('msg_id（可留空）：')).trim();
  }

  const args: Record<string, unknown> = { target: { type, id: id.trim() } };
  if (text.trim()) args.text = text;
  if (filePath) args.file_path = filePath;
  if (msgId) args.msg_id = msgId;
  if (!args.text && !args.file_path) throw new Error('文本和文件至少填一个。');

  const data = await runTool(runtime, 'send_message', args, io);
  if (data) io.write(`发送完成，共 ${Array.isArray(data.sent) ? data.sent.length : 0} 条。\n${pretty(data)}`);
}

async function replyWizard(runtime: Runtime, io: CliIO): Promise<void> {
  const type = (await askRequired(io, '目标类型（c2c/group/channel/dm）：')).toLowerCase();
  const id = await askRequired(io, '目标 ID：');
  const msgId = (await io.ask('msg_id（与 event_id 至少填一个）：')).trim();
  const eventId = (await io.ask('event_id（可留空）：')).trim();
  const text = await askRequired(io, '回复文本：');
  if (!msgId && !eventId) throw new Error('msg_id 和 event_id 至少填一个。');
  const data = await runTool(
    runtime,
    'reply_message',
    {
      target: { type, id },
      text,
      ...(msgId ? { msg_id: msgId } : {}),
      ...(eventId ? { event_id: eventId } : {}),
    },
    io,
  );
  if (data) io.write(`回复完成。\n${pretty(data)}`);
}

function printApiList(data: Record<string, unknown>, io: CliIO): void {
  const apis = Array.isArray(data.apis) ? data.apis : [];
  if (apis.length === 0) {
    io.write('没有匹配的 API。\n');
    return;
  }
  io.write(`共 ${String(data.count ?? apis.length)} 个：\n`);
  for (const item of apis) {
    if (!isRecord(item)) continue;
    const readOnly = item.readOnly ? '读' : '写';
    io.write(`  ${String(item.name).padEnd(28)} ${readOnly}  ${String(item.method)} ${String(item.path)}\n`);
    if (item.summary) io.write(`    ${String(item.summary)}\n`);
  }
}

async function handleEvents(runtime: Runtime, io: CliIO, tokens: string[]): Promise<void> {
  const sub = (tokens[0] ?? 'status').toLowerCase();
  if (sub === 'status') {
    const data = await runTool(runtime, 'event_stream_status', {}, io);
    if (data) io.write(pretty(data));
    return;
  }
  if (sub === 'start') {
    const transport = (tokens[1] ?? 'websocket').toLowerCase();
    if (transport !== 'websocket' && transport !== 'webhook') throw new Error('事件传输必须是 websocket 或 webhook。');
    const data = await runTool(runtime, 'start_event_stream', { transport }, io);
    if (data) io.write(`事件流已启动。\n${pretty(data)}`);
    return;
  }
  if (sub === 'stop') {
    const data = await runTool(runtime, 'stop_event_stream', {}, io);
    if (data) io.write(`事件流已停止。\n${pretty(data)}`);
    return;
  }
  if (sub === 'poll') {
    const limit = tokens[1] ? Number(tokens[1]) : undefined;
    const data = await runTool(runtime, 'poll_events', { ...(limit ? { limit } : {}) }, io);
    if (data) io.write(pretty(data));
    return;
  }
  if (sub === 'wait') {
    const seconds = tokens[1] ? Number(tokens[1]) : 30;
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('等待秒数必须是正数。');
    const data = await runTool(runtime, 'wait_events', { timeout_ms: Math.round(seconds * 1000) }, io);
    if (data) io.write(pretty(data));
    return;
  }
  throw new Error('events 子命令：status/start/stop/poll/wait');
}

export async function runCommand(runtime: Runtime, rawLine: string, io: CliIO): Promise<CommandOutcome> {
  const tokens = splitArgs(rawLine.trim());
  const command = tokens.shift()?.toLowerCase();
  if (!command) return 'continue';
  const normalized = ALIASES[command] ?? command;

  switch (normalized) {
    case 'help':
    case '?':
      io.write(helpText());
      return 'continue';
    case 'status': {
      const data = await runTool(runtime, 'bot_status', {}, io);
      if (data) io.write(pretty(data));
      return 'continue';
    }
    case 'qr': {
      const artifact = await generateQr(resolveQrUrl());
      io.write(formatQr(artifact));
      return 'continue';
    }
    case 'apis': {
      const keyword = tokens.join(' ').trim();
      const data = await runTool(runtime, 'list_apis', { ...(keyword ? { keyword } : {}) }, io);
      if (data) printApiList(data, io);
      return 'continue';
    }
    case 'api': {
      const name = tokens[0];
      if (!name) throw new Error('用法：api <名称>');
      const data = await runTool(runtime, 'get_api', { name }, io);
      if (data) io.write(pretty(data));
      return 'continue';
    }
    case 'config':
      io.write(pretty(safeConfig(runtime)));
      return 'continue';
    case 'mcp':
      io.write('在 MCP 客户端中加入以下配置（env 换成你的真实值）：\n');
      io.write(pretty(mcpConfig()));
      return 'continue';
    case 'send':
      await sendWizard(runtime, io, tokens);
      return 'continue';
    case 'reply':
      await replyWizard(runtime, io);
      return 'continue';
    case 'events':
      await handleEvents(runtime, io, tokens);
      return 'continue';
    case 'exit':
    case 'quit':
    case 'q':
      return 'exit';
    default:
      throw new Error(`未知命令：${normalized}。输入 help 查看命令。`);
  }
}
