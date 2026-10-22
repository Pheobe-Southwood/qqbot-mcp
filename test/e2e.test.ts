import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface JsonRpcResponse {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message: string };
}

async function runServer(
  env: Record<string, string>,
  requests: Array<Record<string, unknown>>,
): Promise<{ responses: Map<number, JsonRpcResponse>; stderr: string }> {
  const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/server.ts')], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const responses = new Map<number, JsonRpcResponse>();
  let stderr = '';
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line) as JsonRpcResponse;
      if (typeof message.id === 'number') responses.set(message.id, message);
    } catch {
      // ignore non-JSON protocol noise
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline && responses.size < requests.filter((request) => 'id' in request).length) {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  return { responses, stderr };
}

function initRequests(extra: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'e2e', version: '1' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    ...extra,
  ];
}

const cleanEnv = {
  QQBOT_APP_ID: '',
  QQBOT_APP_SECRET: '',
  QQBOT_ACCESS_TOKEN: '',
  QQBOT_MCP_MODE: '',
  QQBOT_MCP_EVENT_TRANSPORT: 'off',
};

describe('stdio server', () => {
  it('runs in docs mode without credentials and serves docs tools/resources', async () => {
    const { responses, stderr } = await runServer(
      cleanEnv,
      initRequests([
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'list_categories', arguments: {} },
        },
        { jsonrpc: '2.0', id: 4, method: 'resources/list', params: {} },
        { jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: 'qqbot://status' } },
      ]),
    );
    expect(responses.get(1)?.result).toMatchObject({ serverInfo: { name: 'qqbot-mcp' } });
    const tools = (responses.get(2)?.result?.tools ?? []) as Array<{ name: string }>;
    expect(tools.map((tool) => tool.name)).toContain('list_apis');
    expect(tools.map((tool) => tool.name)).not.toContain('invoke_api');
    expect(tools).toHaveLength(7);
    const categories = JSON.parse(
      ((responses.get(3)?.result?.content as Array<{ text: string }>) ?? [])[0]!.text,
    ) as { categories: unknown[] };
    expect(categories.categories.length).toBeGreaterThan(15);
    const resources = (responses.get(4)?.result?.resources ?? []) as Array<{ uri: string }>;
    expect(resources.map((resource) => resource.uri)).toContain('qqbot://catalog/apis');
    const status = JSON.parse(
      ((responses.get(5)?.result?.contents as Array<{ text: string }>) ?? [])[0]!.text,
    ) as { mode: string };
    expect(status.mode).toBe('docs');
    expect(stderr).toContain('QQbot-MCP ready');
  });

  it('exposes write tools when credentials and write mode are configured', async () => {
    const { responses } = await runServer(
      {
        ...cleanEnv,
        QQBOT_APP_ID: '102000000',
        QQBOT_APP_SECRET: 'fake-secret',
        QQBOT_MCP_MODE: 'write',
      },
      initRequests([{ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }]),
    );
    const tools = (responses.get(2)?.result?.tools ?? []) as Array<{ name: string }>;
    expect(tools).toHaveLength(20);
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['send_message', 'invoke_api', 'start_event_stream', 'query_api']),
    );
  });
});
