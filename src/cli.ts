#!/usr/bin/env node
import { parseCliArgs, helpText, CliUsageError } from './cli/args.js';
import { formatQr, generateQr, qrEnabled, resolveQrUrl } from './cli/qr.js';
import { runRepl } from './cli/repl.js';
import { bootstrapRuntime } from './runtime.js';
import { VERSION } from './version.js';

async function main(): Promise<void> {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliUsageError) {
      process.stderr.write(`[qqbot-mcp] ${error.message}\n\n${helpText()}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  if (options.action === 'help') {
    process.stdout.write(helpText());
    return;
  }
  if (options.action === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (options.action === 'qr') {
    try {
      const artifact = await generateQr(resolveQrUrl());
      process.stdout.write(formatQr(artifact));
    } catch (error) {
      process.stderr.write(`[qqbot-mcp] 二维码生成失败：${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }
  if (options.action === 'mcp') {
    const { runServer } = await import('./server.js');
    await runServer();
    return;
  }

  try {
    const { runtime } = bootstrapRuntime();
    await runRepl(runtime, { showQr: !options.noQr && qrEnabled() });
  } catch (error) {
    process.stderr.write(`[qqbot-mcp] 启动失败：${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`[qqbot-mcp] 致命错误：${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
