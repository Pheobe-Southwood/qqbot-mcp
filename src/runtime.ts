import { Catalog } from './catalog.js';
import { resolveConfig, type Config, type ResolvedConfig } from './config.js';
import type { Runtime } from './tools/index.js';
import { TokenManager } from './client/token.js';
import { QqBotClient } from './client/http.js';
import { MediaService } from './client/media.js';
import { EventStore } from './events/store.js';
import { GatewayClient } from './events/gateway.js';
import { WebhookServer } from './events/webhook.js';
import { AuditLogger } from './safety/audit.js';
import { Logger } from './util/logger.js';

export function createRuntime(config: Config, catalog: Catalog, logger?: Logger): Runtime {
  const log = logger ?? new Logger(config.logLevel);
  const tokenManager = new TokenManager({
    appId: config.appId,
    appSecret: config.appSecret,
    staticToken: config.staticToken,
    tokenUrl: config.tokenUrl,
    timeoutMs: config.timeoutMs,
  });
  const client = new QqBotClient(config, catalog, tokenManager, log);
  const store = new EventStore({ capacity: config.eventBuffer, ttlMs: config.eventTtlMs });
  const gateway = new GatewayClient(config, client, tokenManager, store, log);
  const webhook = new WebhookServer(config, store, log);
  const media = new MediaService(client, config, log);
  const audit = new AuditLogger(config.auditLog, config.auditContent, log);
  return { config, catalog, client, tokenManager, store, gateway, webhook, media, audit, logger: log };
}

export function autostartEvents(runtime: Runtime): void {
  const { config, gateway, webhook, logger } = runtime;
  if (!config.eventAutostart || config.mode === 'docs') return;
  if (config.eventTransport === 'websocket') {
    gateway.start({ waitReadyMs: 0 }).catch((error) => {
      logger.error('Gateway autostart failed.', { error: error instanceof Error ? error.message : String(error) });
    });
  } else if (config.eventTransport === 'webhook') {
    webhook.start().catch((error) => {
      logger.error('Webhook autostart failed.', { error: error instanceof Error ? error.message : String(error) });
    });
  }
}

export interface Bootstrapped {
  resolved: ResolvedConfig;
  runtime: Runtime;
}

export function bootstrapRuntime(env: NodeJS.ProcessEnv = process.env): Bootstrapped {
  const resolved = resolveConfig(env);
  const catalog = Catalog.load();
  const logger = new Logger(resolved.config.logLevel);
  for (const warning of resolved.warnings) logger.warn(warning);
  return { resolved, runtime: createRuntime(resolved.config, catalog, logger) };
}
