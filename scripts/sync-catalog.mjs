// Build the static API/event catalog from the curated sources + QQ wiki pages.
// Usage: npm run gen [-- --only send_group_message]
//
// The generated JSON is committed so the runtime never touches the network and
// builds/tests work offline. Re-run this only when syncing upstream docs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDoc, parseDoc, paramsToSchema } from './lib/docs.mjs';

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, 'src', 'generated');
const sources = JSON.parse(readFileSync(join(ROOT, 'catalog', 'sources.json'), 'utf8'));
const sharedModels = readJson(join(ROOT, 'catalog', 'models.json'), {});
const overrides = readJson(join(ROOT, 'catalog', 'overrides.json'), { apis: {} });
const eventSources = readJson(join(ROOT, 'catalog', 'events.json'), { events: [] });

const INTENT_BITS = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  GUILD_MESSAGES: 1 << 9,
  GUILD_MESSAGE_REACTIONS: 1 << 10,
  DIRECT_MESSAGE: 1 << 12,
  GROUP_AND_C2C_EVENT: 1 << 25,
  INTERACTION: 1 << 26,
  MESSAGE_AUDIT: 1 << 27,
  FORUMS_EVENT: 1 << 28,
  AUDIO_ACTION: 1 << 29,
  PUBLIC_GUILD_MESSAGES: 1 << 30,
};

function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

function parseArgs(argv) {
  const onlyIndex = argv.indexOf('--only');
  return { only: onlyIndex === -1 ? undefined : argv[onlyIndex + 1] };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function deepMergeSchema(base, patch) {
  if (!patch) return base;
  const result = structuredClone(base);
  if (patch.properties) {
    result.properties = { ...(result.properties || {}) };
    for (const [key, value] of Object.entries(patch.properties)) {
      const existing = result.properties[key];
      if (existing && value && typeof existing === 'object' && typeof value === 'object') {
        result.properties[key] = deepMergeSchema(existing, value);
      } else {
        result.properties[key] = value;
      }
    }
  }
  if (patch.required) result.required = [...new Set([...(result.required || []), ...patch.required])];
  for (const key of Object.keys(patch)) {
    if (key === 'properties' || key === 'required') continue;
    result[key] = patch[key];
  }
  if (!result.properties) delete result.properties;
  if (result.type === undefined) result.type = 'object';
  return result;
}

function emptyParsed(docUrl) {
  return {
    docUrl,
    title: '',
    description: '',
    method: '',
    path: '',
    rateLimit: '',
    pathParams: [],
    queryParams: [],
    bodyParams: [],
    multipartFields: [],
    models: {},
    response: { description: '', fields: [] },
    errors: [],
    examples: [],
    warnings: [],
  };
}

function buildInputSchema(pathSchema, querySchema, bodySchema) {
  const properties = {};
  if (Object.keys(pathSchema.properties || {}).length > 0) properties.path = pathSchema;
  if (Object.keys(querySchema.properties || {}).length > 0) properties.query = querySchema;
  if (Object.keys(bodySchema.properties || {}).length > 0) properties.body = bodySchema;
  const schema = { type: 'object', properties, additionalProperties: false };
  if (properties.path) schema.required = ['path'];
  return schema;
}

async function buildApi(source) {
  let parsed = emptyParsed(source.docUrl);
  const warnings = [];
  try {
    const html = await loadDoc(source.docUrl);
    parsed = parseDoc(html, {
      docUrl: source.docUrl,
      expectedPath: source.path,
      expectedMethod: source.method,
      sectionHeading: source.sectionHeading,
    });
  } catch (error) {
    warnings.push(`docs fetch/parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  warnings.push(...parsed.warnings.filter((warning) => !/missing HTTP path/.test(warning)));
  if (parsed.method && parsed.method !== source.method) {
    warnings.push(`method mismatch: sources=${source.method} docs=${parsed.method}`);
  }
  if (parsed.path && parsed.path !== source.path) {
    warnings.push(`path mismatch: sources=${source.path} docs=${parsed.path}`);
  }

  const localModels = { ...sharedModels, ...parsed.models };
  const override = overrides.apis?.[source.name] || {};
  const bodySchema = deepMergeSchema(
    paramsToSchema(parsed.bodyParams, localModels, { docUrl: source.docUrl }),
    override.bodySchema,
  );
  const querySchema = deepMergeSchema(
    paramsToSchema(parsed.queryParams, localModels, { docUrl: source.docUrl }),
    override.querySchema,
  );
  const pathSchema = deepMergeSchema(
    paramsToSchema(parsed.pathParams, localModels, { docUrl: source.docUrl }),
    override.pathSchema,
  );

  const docType = (schema) => {
    if (!schema || typeof schema !== 'object') return '';
    if (schema.type === 'array') return schema.items?.type === 'object' ? 'array' : `[]${schema.items?.type || 'object'}`;
    if (schema.type === 'integer' || schema.type === 'number' || schema.type === 'boolean' || schema.type === 'string') {
      return schema.type;
    }
    return 'object';
  };
  const mergeParamsFromSchema = (params, schema) => {
    if (!schema?.properties) return params;
    for (const [name, prop] of Object.entries(schema.properties)) {
      const existing = params.find((param) => param.name === name);
      const required = Array.isArray(schema.required) ? schema.required.includes(name) : undefined;
      if (existing) {
        existing.type = docType(prop) || existing.type;
        existing.required = required ?? existing.required;
        existing.description = prop.description || existing.description;
      } else {
        params.push({
          name,
          type: docType(prop),
          required,
          description: prop.description || '',
        });
      }
    }
    return params;
  };
  const finalBodyParams = mergeParamsFromSchema(parsed.bodyParams, bodySchema);
  const finalQueryParams = mergeParamsFromSchema(parsed.queryParams, querySchema);
  const finalPathParams = mergeParamsFromSchema(parsed.pathParams, pathSchema);

  const unique = (items) => [...new Set(items)];
  const multipartFields = [
    ...parsed.multipartFields,
    ...(override.multipartFields || []),
  ].map((field) => (typeof field === 'string' ? { name: field } : field));

  return {
    name: source.name,
    aliases: unique(source.aliases || []),
    category: source.category,
    summary: source.summary,
    description: override.description ?? (parsed.description || source.summary),
    notes: override.notes || [],
    method: source.method,
    path: source.path,
    readOnly: source.readOnly !== false,
    legacy: source.legacy === true,
    deprecated: source.deprecated === true,
    permissionRequired: source.permissionRequired === true,
    rateLimit: override.rateLimit ?? parsed.rateLimit ?? '',
    docUrl: source.docUrl,
    docTitle: parsed.title || '',
    pathParams: finalPathParams.length > 0 ? finalPathParams : pathParamsFromTemplate(source.path),
    queryParams: finalQueryParams,
    bodyParams: finalBodyParams,
    bodySchema,
    querySchema,
    pathSchema,
    multipartFields,
    response: override.response ?? parsed.response,
    errors: parsed.errors,
    examples: [...(override.examples || []), ...parsed.examples].slice(0, 8),
    inputSchema: buildInputSchema(pathSchema, querySchema, bodySchema),
    warnings,
  };
}

function pathParamsFromTemplate(path) {
  return [...path.matchAll(/\{([^}/]+)\}/g)].map((match) => ({
    name: match[1],
    type: 'string',
    required: true,
    description: '路径参数',
  }));
}

async function buildEvent(source) {
  const intentBits = (source.intents || []).reduce((sum, name) => sum + (INTENT_BITS[name] || 0), 0);
  let payload = source.payload || [];
  let examples = source.examples || [];
  let description = source.description || '';
  const warnings = [];
  // Only single-event autogen pages have a reliable payload table; channel
  // event pages often bundle several events and expose JSON examples instead.
  if (source.docUrl && source.docUrl.includes('/autogen/event/')) {
    try {
      const html = await loadDoc(source.docUrl);
      const parsed = parseDoc(html, { docUrl: source.docUrl });
      payload = parsed.bodyParams.length > 0 ? parsed.bodyParams : payload;
      examples = parsed.examples.length > 0 ? parsed.examples : examples;
      description = description || parsed.description;
    } catch (error) {
      warnings.push(`docs fetch/parse failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const models = { ...sharedModels };
  return {
    name: source.name,
    category: source.category,
    summary: source.summary,
    description,
    docUrl: source.docUrl || '',
    intents: source.intents || [],
    intentBits,
    payload,
    payloadSchema: paramsToSchema(payload, models, { docUrl: source.docUrl || '' }),
    examples,
    warnings,
  };
}

const { only } = parseArgs(process.argv.slice(2));
const selected = sources.apis.filter((api) => !only || api.name === only || api.aliases?.includes(only));
if (selected.length === 0) {
  console.error(`No API matched --only ${only}`);
  process.exit(1);
}

console.error(`Syncing ${selected.length} API docs (cache: .cache/docs)…`);
let done = 0;
const apis = await mapLimit(selected, 6, async (source) => {
  const api = await buildApi(source);
  done++;
  if (done % 10 === 0 || done === selected.length) console.error(`  ${done}/${selected.length}`);
  return api;
});

const events = await mapLimit(eventSources.events, 6, buildEvent);

const categoryOrder = [];
const categoryCounts = new Map();
for (const api of apis) {
  if (!categoryCounts.has(api.category)) {
    categoryOrder.push(api.category);
    categoryCounts.set(api.category, 0);
  }
  categoryCounts.set(api.category, categoryCounts.get(api.category) + 1);
}
const categories = categoryOrder.map((name) => ({ name, count: categoryCounts.get(name) }));

const catalog = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  upstream: sources.upstream,
  note: 'Generated by scripts/sync-catalog.mjs. Do not edit by hand.',
  apiCount: apis.length,
  categories,
  apis,
};
const eventCatalog = {
  schemaVersion: 1,
  generatedAt: catalog.generatedAt,
  upstream: sources.upstream,
  eventCount: events.length,
  intents: Object.fromEntries(Object.entries(INTENT_BITS).map(([name, bit]) => [name, bit])),
  events,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
writeFileSync(join(OUT_DIR, 'events.json'), `${JSON.stringify(eventCatalog, null, 2)}\n`);

const warnings = [...apis, ...events].filter((item) => item.warnings.length > 0);
console.error(
  `Generated ${apis.length} APIs (${categories.length} categories) and ${events.length} events → src/generated/.`,
);
if (warnings.length > 0) {
  console.error(`Warnings (${warnings.length}):`);
  for (const item of warnings.slice(0, 20)) {
    console.error(`  - ${item.name}: ${item.warnings.join('; ')}`);
  }
  if (warnings.length > 20) console.error(`  … and ${warnings.length - 20} more`);
}
