// Shared types for the catalog, MCP tools and runtime.

export type Mode = 'docs' | 'read' | 'write';

export interface ParamDoc {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: unknown[];
  description?: string;
  title?: string;
  format?: string;
  additionalProperties?: boolean | JsonSchema;
  [key: string]: unknown;
}

export interface ApiSpec {
  name: string;
  aliases: string[];
  category: string;
  summary: string;
  description: string;
  notes: string[];
  method: string;
  path: string;
  readOnly: boolean;
  legacy: boolean;
  deprecated: boolean;
  permissionRequired: boolean;
  rateLimit: string;
  docUrl: string;
  docTitle: string;
  pathParams: ParamDoc[];
  queryParams: ParamDoc[];
  bodyParams: ParamDoc[];
  bodySchema: JsonSchema;
  querySchema: JsonSchema;
  pathSchema: JsonSchema;
  multipartFields: ParamDoc[];
  response: { description: string; fields: ParamDoc[] };
  errors: Array<{ code: string; description: string; hint: string }>;
  examples: Array<{ title: string; body: unknown }>;
  inputSchema: JsonSchema;
  warnings: string[];
}

export interface EventSpec {
  name: string;
  category: string;
  summary: string;
  description: string;
  docUrl: string;
  intents: string[];
  intentBits: number;
  payload: ParamDoc[];
  payloadSchema: JsonSchema;
  examples: Array<{ title: string; body: unknown }>;
  warnings: string[];
  payloadNote?: string;
}

export interface CatalogFile {
  schemaVersion: number;
  generatedAt: string;
  upstream: string;
  note: string;
  apiCount: number;
  categories: Array<{ name: string; count: number }>;
  apis: ApiSpec[];
}

export interface EventCatalogFile {
  schemaVersion: number;
  generatedAt: string;
  upstream: string;
  eventCount: number;
  intents: Record<string, number>;
  events: EventSpec[];
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

export interface StoredEvent {
  seq: number;
  id: string;
  type: string;
  receivedAt: string;
  shard?: [number, number];
  data: unknown;
  raw: unknown;
}

export type Scene = 'c2c' | 'group' | 'channel' | 'dm';

export interface MessageTarget {
  type: Scene;
  id: string;
}

export interface CacheStatus {
  configured: boolean;
  source: 'static' | 'app' | 'none';
  expiresAt: number | null;
  valid: boolean;
}
