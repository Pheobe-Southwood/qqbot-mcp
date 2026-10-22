#!/usr/bin/env node
// CLI smoke test: help, QR image, interactive banner and MCP compatibility.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = await mkdtemp(join(tmpdir(), 'qqbot-mcp-smoke-'));
const env = {
  ...process.env,
  TMPDIR: tempDir,
  QQBOT_APP_ID: '',
  QQBOT_APP_SECRET: '',
  QQBOT_ACCESS_TOKEN: '',
  QQBOT_MCP_MODE: '',
  QQBOT_MCP_EVENT_TRANSPORT: 'off',
  QQBOT_MCP_QR: 'on',
};

function fail(message, extra = '') {
  console.error(`CLI SMOKE FAIL: ${message}`);
  if (extra) console.error(extra.trim());
  process.exit(1);
}

function run(args, input = '') {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: process.cwd(),
    env,
    input,
    encoding: 'utf8',
    timeout: 20_000,
  });
}

try {
  const help = run(['--help']);
  if (help.status !== 0) fail('--help exited non-zero', help.stderr);
  if (!help.stdout.includes('--mcp') || !help.stdout.includes('--qr')) fail('--help missing options');

  const qr = run(['--qr']);
  if (qr.status !== 0) fail('--qr exited non-zero', qr.stderr);
  if (!qr.stdout.includes('扫码创建/连接 QQ 机器人')) fail('QR heading missing');
  if (!qr.stdout.includes('https://q.qq.com/qqbot/openclaw/login.html')) fail('QR URL missing');
  const match = qr.stdout.match(/二维码图片：(.+\.png)/);
  if (!match) fail('QR image path missing');
  const imagePath = match[1].trim();
  const bytes = await readFile(imagePath);
  if (bytes.subarray(1, 4).toString('ascii') !== 'PNG') fail('QR image is not a PNG');
  if (((await stat(imagePath)).mode & 0o777) !== 0o600) fail('QR image is not 0600');

  const cli = run(['--cli', '--no-qr'], 'exit\n');
  if (cli.status !== 0) fail('--cli exited non-zero', cli.stderr);
  if (!cli.stdout.includes('QQbot-MCP')) fail('CLI banner missing');
  if (!cli.stdout.includes('qqbot>')) fail('CLI prompt missing');

  const requests = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'cli-smoke', version: '1' } },
    },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ];

  async function mcp(args, label) {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
      cwd: process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !(stdout.includes('"id":2') || stdout.includes('"id": 2'))) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));

    const lines = stdout.trim().split('\n').filter(Boolean);
    if (lines.length < 2) fail(`${label}: missing MCP responses`, stderr);
    for (const line of lines) {
      try {
        JSON.parse(line);
      } catch {
        fail(`${label}: stdout contains non-JSON content: ${line.slice(0, 120)}`);
      }
    }
    const toolsLine = lines.find((line) => {
      try {
        return JSON.parse(line).id === 2;
      } catch {
        return false;
      }
    });
    const tools = JSON.parse(toolsLine).result.tools;
    if (tools.length !== 7) fail(`${label}: expected 7 docs tools, got ${tools.length}`);
  }

  await mcp(['--mcp'], '--mcp');
  await mcp([], 'default non-TTY');

  console.log('CLI SMOKE PASS: help, QR PNG, interactive banner, MCP fallback');
  console.log(`  qr=${imagePath}`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
