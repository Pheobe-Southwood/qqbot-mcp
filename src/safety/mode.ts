import type { Mode } from '../types.js';
import { ToolError } from '../client/errors.js';

const LEVEL: Record<Mode, number> = { docs: 0, read: 1, write: 2 };

export function modeAllows(current: Mode, required: Mode): boolean {
  return LEVEL[current] >= LEVEL[required];
}

export function assertMode(current: Mode, required: Mode, toolName: string): void {
  if (modeAllows(current, required)) return;
  const hint =
    required === 'write'
      ? 'Set QQBOT_MCP_MODE=write (and provide credentials) to call write tools.'
      : 'Set QQBOT_MCP_MODE=read or write to call this tool.';
  throw new ToolError(
    `Tool "${toolName}" requires ${required} mode, but the server is running in ${current} mode.`,
    { hint },
  );
}

export const READ_TOOLS = new Set([
  'query_api',
  'poll_events',
  'wait_events',
  'clear_events',
  'event_stream_status',
  'download_attachment',
]);

export const WRITE_TOOLS = new Set([
  'invoke_api',
  'send_message',
  'reply_message',
  'upload_media',
  'recall_message',
  'start_event_stream',
  'stop_event_stream',
]);

export const DOC_TOOLS = new Set([
  'list_apis',
  'get_api',
  'search_apis',
  'list_categories',
  'list_event_types',
  'get_event_type',
  'bot_status',
]);

export function requiredModeForTool(name: string): Mode | undefined {
  if (WRITE_TOOLS.has(name)) return 'write';
  if (READ_TOOLS.has(name)) return 'read';
  if (DOC_TOOLS.has(name)) return 'docs';
  return undefined;
}
