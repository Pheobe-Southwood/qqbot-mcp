#!/usr/bin/env node
// End-to-end stdio smoke test. Runs the TypeScript entrypoint directly so it
// works before `npm run build`; uses no credentials and no network.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    QQBOT_APP_ID: '',
    QQBOT_APP_SECRET: '',
    QQBOT_ACCESS_TOKEN: '',
    QQBOT_MCP_MODE: '',
    QQBOT_MCP_EVENT_TRANSPORT: 'off',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

const responses = new Map();
let stderr = '';
createInterface({ input: child.stdout }).on('line', (line) => {
  try {
    const message = JSON.parse(line);
    if (typeof message.id === 'number') responses.set(message.id, message);
  } catch {
    // stdout should only contain JSON-RPC; ignore unexpected noise for the check
  }
});
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

const requests = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_apis', arguments: {} } },
  { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_api', arguments: { name: 'send_group_message' } } },
  { jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: 'qqbot://catalog/apis' } },
];
for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);

const deadline = Date.now() + 15_000;
while (Date.now() < deadline && responses.size < 5) await new Promise((resolve) => setTimeout(resolve, 50));
child.kill('SIGTERM');
await new Promise((resolve) => child.once('exit', resolve));

const fail = (message) => {
  console.error(`SMOKE FAIL: ${message}`);
  if (stderr) console.error(stderr.trim());
  process.exit(1);
};

if (responses.size < 5) fail(`only ${responses.size}/5 responses received`);
if (responses.get(1)?.result?.serverInfo?.name !== 'qqbot-mcp') fail('initialize failed');
const tools = responses.get(2)?.result?.tools ?? [];
if (tools.length !== 7) fail(`expected 7 docs-mode tools, got ${tools.length}`);
if (!tools.some((tool) => tool.name === 'list_apis')) fail('list_apis tool missing');
const apis = JSON.parse(responses.get(3).result.content[0].text);
if (apis.count !== 103) fail(`expected 103 APIs, got ${apis.count}`);
const api = JSON.parse(responses.get(4).result.content[0].text).api;
if (api.path !== '/v2/groups/{group_openid}/messages') fail(`unexpected send_group_message path: ${api.path}`);
const catalogResource = JSON.parse(responses.get(5).result.contents[0].text);
if (catalogResource.count !== 103) fail('catalog resource count mismatch');
if (!stderr.includes('QQbot-MCP ready')) fail('server did not log readiness');

console.log('SMOKE PASS: initialize, tools/list, tools/call, resources/read');
console.log(`  tools=${tools.length} apis=${apis.count} catalog_resource=${catalogResource.count} example=${api.name}`);
