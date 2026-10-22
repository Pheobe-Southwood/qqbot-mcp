#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { resolveConfig } from './config.js';
import { Catalog } from './catalog.js';
import { Logger } from './util/logger.js';
import { callTool, toolsForMode } from './tools/index.js';
import { RESOURCES, readResource } from './resources.js';
import { autostartEvents, createRuntime } from './runtime.js';
import { VERSION } from './version.js';

export async function runServer(): Promise<void> {
  let resolved;
  try {
    resolved = resolveConfig();
  } catch (error) {
    process.stderr.write(`[qqbot-mcp] configuration error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  const logger = new Logger(resolved.config.logLevel);
  for (const warning of resolved.warnings) logger.warn(warning);

  let catalog: Catalog;
  try {
    catalog = Catalog.load();
  } catch (error) {
    logger.error('Failed to load the generated catalog. Run `npm run gen` or reinstall the package.', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  const config = resolved.config;
  const runtime = createRuntime(config, catalog, logger);
  const { gateway, webhook, tokenManager } = runtime;

  const server = new Server(
    { name: 'qqbot-mcp', version: VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = toolsForMode(config.mode).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
    }));
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const result = await callTool(runtime, request.params.name, request.params.arguments, {
      signal: extra.signal,
    });
    return result as unknown as { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    try {
      return { contents: [readResource(runtime, request.params.uri)] };
    } catch (error) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown resource: ${request.params.uri}`,
        { detail: error instanceof Error ? error.message : String(error) },
      );
    }
  });

  autostartEvents(runtime);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('QQbot-MCP ready.', {
    version: VERSION,
    mode: config.mode,
    tools: toolsForMode(config.mode).length,
    catalog_apis: catalog.file.apiCount,
    catalog_events: catalog.eventFile.eventCount,
    credentials: tokenManager.status().configured ? tokenManager.status().source : 'none',
    events: config.eventTransport,
  });

  const shutdown = (signal: string): void => {
    logger.info('Shutting down.', { signal });
    void (async () => {
      await gateway.stop().catch(() => undefined);
      await webhook.stop().catch(() => undefined);
      await server.close().catch(() => undefined);
      process.exit(0);
    })();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection.', { error: reason instanceof Error ? reason.message : String(reason) });
  });
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception.', { error: error.message });
  });
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  runServer().catch((error) => {
    process.stderr.write(`[qqbot-mcp] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
