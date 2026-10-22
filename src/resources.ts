import type { Runtime } from './tools/index.js';

export interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

export const RESOURCES = [
  {
    uri: 'qqbot://catalog/apis',
    name: 'QQ bot API catalog',
    description: 'All 103 curated QQ OpenAPI endpoints with method, path, read-only flag and category.',
    mimeType: 'application/json',
  },
  {
    uri: 'qqbot://catalog/events',
    name: 'QQ bot event catalog',
    description: 'All 53 gateway/webhook event types with categories and required intents.',
    mimeType: 'application/json',
  },
  {
    uri: 'qqbot://events/recent',
    name: 'Recent buffered events',
    description: 'The last 50 events currently buffered by the event transport (peek, does not consume).',
    mimeType: 'application/json',
  },
  {
    uri: 'qqbot://status',
    name: 'Runtime status',
    description: 'Mode, catalog version, token presence, event transport and buffer status.',
    mimeType: 'application/json',
  },
];

export function readResource(runtime: Runtime, uri: string): ResourceContent {
  switch (uri) {
    case 'qqbot://catalog/apis':
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            generatedAt: runtime.catalog.file.generatedAt,
            upstream: runtime.catalog.file.upstream,
            count: runtime.catalog.file.apiCount,
            categories: runtime.catalog.categories(),
            apis: runtime.catalog.listApis({ includeLegacy: true }),
          },
          null,
          2,
        ),
      };
    case 'qqbot://catalog/events':
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            generatedAt: runtime.catalog.eventFile.generatedAt,
            upstream: runtime.catalog.eventFile.upstream,
            count: runtime.catalog.eventFile.eventCount,
            intents: runtime.catalog.eventFile.intents,
            events: runtime.catalog.listEvents({}),
          },
          null,
          2,
        ),
      };
    case 'qqbot://events/recent': {
      const events = runtime.store.poll({ limit: 50, peek: true });
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            transport: runtime.config.eventTransport,
            gateway_state: runtime.gateway.status().state,
            webhook_listening: runtime.webhook.status().listening,
            count: events.events.length,
            events: events.events,
          },
          null,
          2,
        ),
      };
    }
    case 'qqbot://status':
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            mode: runtime.config.mode,
            credentials: runtime.tokenManager.status(),
            catalog: runtime.catalog.stats(),
            events: {
              transport: runtime.config.eventTransport,
              gateway: runtime.gateway.status(),
              webhook: runtime.webhook.status(),
              store: runtime.store.status(),
            },
            upload_root: runtime.config.uploadRoot ?? null,
            download_dir: runtime.config.downloadDir,
          },
          null,
          2,
        ),
      };
    default:
      throw new Error(`Unknown resource URI: ${uri}`);
  }
}
