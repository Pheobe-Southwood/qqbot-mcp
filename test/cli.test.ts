import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCliArgs, CliUsageError } from '../src/cli/args.js';
import { DEFAULT_QR_URL, formatQr, generateQr, qrEnabled, resolveQrUrl } from '../src/cli/qr.js';
import { runCommand, splitArgs, type CliIO } from '../src/cli/commands.js';
import { resolveConfig } from '../src/config.js';
import type { Runtime } from '../src/tools/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function io(): CliIO & { out: string; err: string } {
  return {
    out: '',
    err: '',
    write(text) {
      this.out += text;
    },
    error(text) {
      this.err += text;
    },
    ask: async () => '',
  };
}

function fakeRuntime(): Runtime {
  const config = resolveConfig({ QQBOT_ACCESS_TOKEN: 'tok', QQBOT_MCP_MODE: 'read' }).config;
  return {
    config,
    catalog: { file: { apiCount: 103 }, eventFile: { eventCount: 53 } },
    tokenManager: { status: () => ({ configured: true, source: 'static', valid: true }) },
  } as unknown as Runtime;
}

describe('CLI arguments', () => {
  it('uses CLI on a TTY and MCP otherwise', () => {
    expect(parseCliArgs([], { stdin: true, stdout: true }).action).toBe('cli');
    expect(parseCliArgs([], { stdin: false, stdout: false }).action).toBe('mcp');
  });

  it('supports explicit modes and QR flags', () => {
    expect(parseCliArgs(['--mcp'], { stdin: true, stdout: true })).toMatchObject({ action: 'mcp' });
    expect(parseCliArgs(['--cli'], { stdin: false, stdout: false })).toMatchObject({ action: 'cli' });
    expect(parseCliArgs(['--qr'], { stdin: false, stdout: false })).toMatchObject({ action: 'qr' });
    expect(parseCliArgs(['--cli', '--no-qr'], { stdin: true, stdout: true })).toMatchObject({ action: 'cli', noQr: true });
    expect(parseCliArgs(['--help']).action).toBe('help');
    expect(parseCliArgs(['--version']).action).toBe('version');
  });

  it('rejects conflicting or unknown options', () => {
    expect(() => parseCliArgs(['--mcp', '--cli'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--qr', '--mcp'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--what'])).toThrow(/未知参数/);
  });
});

describe('QR generation', () => {
  it('uses the QQ onboarding link by default and allows overrides', () => {
    expect(resolveQrUrl({})).toBe(DEFAULT_QR_URL);
    expect(resolveQrUrl({ QQBOT_MCP_QR_URL: 'https://example.com/bot' })).toBe('https://example.com/bot');
    expect(qrEnabled({ QQBOT_MCP_QR: 'off' })).toBe(false);
    expect(qrEnabled({})).toBe(true);
  });

  it('writes a 0600 PNG and prints the path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qqbot-mcp-test-'));
    tempDirs.push(dir);
    const artifact = await generateQr('https://example.com/bot', { dir, now: 1234567890 });
    expect(artifact.imagePath).toBe(join(dir, 'qqbot-mcp-qr-1234567890.png'));
    expect(artifact.terminal).toContain('█');
    const bytes = await readFile(artifact.imagePath);
    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect((await stat(artifact.imagePath)).mode & 0o777).toBe(0o600);
    expect(formatQr(artifact)).toContain('二维码图片：');
    expect(formatQr(artifact)).toContain(artifact.imagePath);
  });
});

describe('CLI commands', () => {
  it('splits quoted arguments', () => {
    expect(splitArgs('send group G "hello world"')).toEqual(['send', 'group', 'G', 'hello world']);
    expect(splitArgs("send group G 'hi there'")).toEqual(['send', 'group', 'G', 'hi there']);
  });

  it('prints help and MCP config without network access', async () => {
    const context = io();
    expect(await runCommand(fakeRuntime(), 'help', context)).toBe('continue');
    expect(context.out).toContain('qqbot-mcp --mcp');
    context.out = '';
    await runCommand(fakeRuntime(), 'mcp', context);
    expect(context.out).toContain('"command": "npx"');
    expect(context.out).toContain('qqbot-mcp');
  });

  it('prints config without leaking secrets', async () => {
    const context = io();
    await runCommand(fakeRuntime(), 'config', context);
    expect(context.out).toContain('api_base');
    expect(context.out).not.toContain('tok');
    expect(context.out).not.toContain('appSecret');
  });
});
