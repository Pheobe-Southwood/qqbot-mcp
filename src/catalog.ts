import { readFileSync } from 'node:fs';
import type { ApiSpec, CatalogFile, EventCatalogFile, EventSpec, JsonSchema } from './types.js';

export interface LiteApi {
  name: string;
  category: string;
  summary: string;
  method: string;
  path: string;
  readOnly: boolean;
  aliases: string[];
  legacy: boolean;
  deprecated: boolean;
  permissionRequired: boolean;
  rateLimit: string;
}

export interface SearchHit extends LiteApi {
  score: number;
}

export class Catalog {
  private readonly byName = new Map<string, ApiSpec>();
  private readonly eventByName = new Map<string, EventSpec>();
  private readonly errorIndex = new Map<string, { description: string; hint: string }>();

  constructor(
    readonly file: CatalogFile,
    readonly eventFile: EventCatalogFile,
  ) {
    for (const api of file.apis) {
      for (const key of [api.name, ...api.aliases]) {
        this.byName.set(key.toLowerCase(), api);
      }
      for (const error of api.errors) {
        if (error.code && !this.errorIndex.has(error.code)) {
          this.errorIndex.set(error.code, { description: error.description, hint: error.hint });
        }
      }
    }
    for (const event of eventFile.events) {
      this.eventByName.set(event.name.toLowerCase(), event);
    }
  }

  static load(): Catalog {
    const catalogRaw = readFileSync(new URL('./generated/catalog.json', import.meta.url), 'utf8');
    const eventsRaw = readFileSync(new URL('./generated/events.json', import.meta.url), 'utf8');
    return new Catalog(JSON.parse(catalogRaw) as CatalogFile, JSON.parse(eventsRaw) as EventCatalogFile);
  }

  getApi(name: string): ApiSpec | undefined {
    return this.byName.get(name.trim().toLowerCase());
  }

  requireApi(name: string): ApiSpec {
    const api = this.getApi(name);
    if (!api) {
      const suggestions = this.search(name, 5)
        .map((hit) => hit.name)
        .join(', ');
      throw new Error(`Unknown API "${name}".${suggestions ? ` Did you mean: ${suggestions}?` : ' Use search_apis to find one.'}`);
    }
    return api;
  }

  getEvent(name: string): EventSpec | undefined {
    return this.eventByName.get(name.trim().toLowerCase());
  }

  requireEvent(name: string): EventSpec {
    const event = this.getEvent(name);
    if (!event) {
      const suggestions = this.eventFile.events
        .filter((candidate) => candidate.name.includes(name.toUpperCase()))
        .slice(0, 5)
        .map((candidate) => candidate.name)
        .join(', ');
      throw new Error(`Unknown event type "${name}".${suggestions ? ` Did you mean: ${suggestions}?` : ' Use list_event_types.'}`);
    }
    return event;
  }

  listApis(filter: { category?: string; readOnly?: boolean; includeLegacy?: boolean; keyword?: string } = {}): LiteApi[] {
    return this.file.apis
      .filter((api) => {
        if (filter.category && api.category !== filter.category) return false;
        if (filter.readOnly !== undefined && api.readOnly !== filter.readOnly) return false;
        if (filter.includeLegacy === false && (api.legacy || api.deprecated)) return false;
        if (filter.keyword) {
          const needle = filter.keyword.toLowerCase();
          const haystack = `${api.name} ${api.aliases.join(' ')} ${api.summary} ${api.path} ${api.category}`.toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        return true;
      })
      .map(toLite);
  }

  search(query: string, limit = 20): SearchHit[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const hits: SearchHit[] = [];
    for (const api of this.file.apis) {
      let score = 0;
      const name = api.name.toLowerCase();
      if (name === needle) score = 100;
      else if (api.aliases.some((alias) => alias.toLowerCase() === needle)) score = 95;
      else if (name.startsWith(needle)) score = 80;
      else if (api.aliases.some((alias) => alias.toLowerCase().startsWith(needle))) score = 75;
      else if (name.includes(needle)) score = 60;
      else if (api.aliases.some((alias) => alias.toLowerCase().includes(needle))) score = 55;
      else if (api.path.toLowerCase().includes(needle)) score = 40;
      else if (api.summary.toLowerCase().includes(needle)) score = 30;
      else if (api.description.toLowerCase().includes(needle)) score = 15;
      if (score > 0) hits.push({ ...toLite(api), score });
    }
    return hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
  }

  listEvents(filter: { intent?: string; category?: string; keyword?: string } = {}): Array<Omit<EventSpec, 'payload' | 'payloadSchema' | 'examples' | 'description' | 'warnings'>> {
    return this.eventFile.events
      .filter((event) => {
        if (filter.category && event.category !== filter.category) return false;
        if (filter.intent && !event.intents.includes(filter.intent)) return false;
        if (filter.keyword) {
          const needle = filter.keyword.toLowerCase();
          const haystack = `${event.name} ${event.category} ${event.summary} ${event.intents.join(' ')}`.toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        return true;
      })
      .map((event) => ({
        name: event.name,
        category: event.category,
        summary: event.summary,
        docUrl: event.docUrl,
        intents: event.intents,
        intentBits: event.intentBits,
      }));
  }

  categories(): Array<{ name: string; count: number }> {
    return this.file.categories;
  }

  apiDoc(api: ApiSpec): Record<string, unknown> {
    return {
      name: api.name,
      aliases: api.aliases,
      category: api.category,
      summary: api.summary,
      description: api.description,
      notes: api.notes,
      method: api.method,
      path: api.path,
      readOnly: api.readOnly,
      legacy: api.legacy,
      deprecated: api.deprecated,
      permissionRequired: api.permissionRequired,
      rateLimit: api.rateLimit,
      docUrl: api.docUrl,
      docTitle: api.docTitle,
      params: {
        path: api.pathParams,
        query: api.queryParams,
        body: api.bodyParams,
        multipart: api.multipartFields,
      },
      inputSchema: api.inputSchema,
      bodySchema: api.bodySchema,
      querySchema: api.querySchema,
      pathSchema: api.pathSchema,
      response: api.response,
      errors: api.errors,
      examples: api.examples,
      warnings: api.warnings,
    };
  }

  eventDoc(event: EventSpec): Record<string, unknown> {
    return {
      name: event.name,
      category: event.category,
      summary: event.summary,
      description: event.description,
      docUrl: event.docUrl,
      intents: event.intents,
      intentBits: event.intentBits,
      payloadNote: event.payloadNote,
      payload: event.payload,
      payloadSchema: event.payloadSchema,
      examples: event.examples,
    };
  }

  explainError(code: string | number | undefined): { description: string; hint: string } | undefined {
    return code === undefined ? undefined : this.errorIndex.get(String(code));
  }

  stats(): Record<string, unknown> {
    return {
      catalogVersion: this.file.schemaVersion,
      generatedAt: this.file.generatedAt,
      upstream: this.file.upstream,
      apiCount: this.file.apiCount,
      categoryCount: this.file.categories.length,
      eventCount: this.eventFile.eventCount,
      legacyApis: this.file.apis.filter((api) => api.legacy).map((api) => api.name),
      deprecatedApis: this.file.apis.filter((api) => api.deprecated).map((api) => api.name),
    };
  }
}

function toLite(api: ApiSpec): LiteApi {
  return {
    name: api.name,
    category: api.category,
    summary: api.summary,
    method: api.method,
    path: api.path,
    readOnly: api.readOnly,
    aliases: api.aliases,
    legacy: api.legacy,
    deprecated: api.deprecated,
    permissionRequired: api.permissionRequired,
    rateLimit: api.rateLimit,
  };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function schemaTypeLabel(schema: JsonSchema | undefined): string {
  if (!schema) return 'unknown';
  if (schema.type === 'array') return `array<${schemaTypeLabel(schema.items)}>`;
  return schema.type || 'object';
}
