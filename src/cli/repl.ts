import { createInterface } from 'node:readline/promises';
import type { Runtime } from '../tools/index.js';
import { autostartEvents } from '../runtime.js';
import { VERSION } from '../version.js';
import { formatQr, generateQr, resolveQrUrl } from './qr.js';
import { runCommand, type CliIO } from './commands.js';

export interface ReplOptions {
  showQr: boolean;
}

function banner(runtime: Runtime): string {
  const credentials = runtime.tokenManager.status();
  const credentialText = credentials.configured
    ? `已配置（${credentials.source === 'static' ? '静态 token' : 'AppID/AppSecret'}）`
    : '未配置，当前为 docs 模式';
  return [
    `QQbot-MCP ${VERSION}`,
    `模式：${runtime.config.mode}　凭据：${credentialText}`,
    `目录：${runtime.catalog.file.apiCount} 个 API / ${runtime.catalog.eventFile.eventCount} 个事件`,
    '',
    '输入 help 查看命令，exit 退出。',
    '',
  ].join('\n');
}

export async function runRepl(runtime: Runtime, options: ReplOptions): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });
  const io: CliIO = {
    write: (text) => process.stdout.write(text),
    error: (text) => process.stderr.write(text),
    ask: (prompt) => rl.question(prompt),
  };

  io.write(banner(runtime));
  autostartEvents(runtime);

  if (options.showQr) {
    try {
      const artifact = await generateQr(resolveQrUrl());
      io.write(formatQr(artifact));
    } catch (error) {
      io.error(`二维码生成失败：${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  const onSignal = (): void => {
    rl.close();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  let exit = false;
  try {
    while (!exit) {
      let line: string;
      try {
        line = await rl.question('qqbot> ');
      } catch {
        break;
      }
      if (!line.trim()) continue;
      try {
        exit = (await runCommand(runtime, line, io)) === 'exit';
      } catch (error) {
        io.error(`错误：${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    rl.close();
    await runtime.gateway.stop().catch(() => undefined);
    await runtime.webhook.stop().catch(() => undefined);
  }
}
