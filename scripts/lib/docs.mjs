// Documentation parser shared by the catalog sync and coverage scripts.
// It intentionally has no runtime dependencies: QQ's wiki is VuePress-rendered
// HTML, so we walk headings/tables/<pre> blocks in document order.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CACHE_DIR = process.env.QQBOT_DOC_CACHE || '.cache/docs';

export async function loadDoc(url, { cache = true, timeoutMs = 30_000 } = {}) {
  const file = join(CACHE_DIR, `${createHash('sha1').update(url).digest('hex')}.html`);
  if (cache && existsSync(file)) return readFileSync(file, 'utf8');
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'qqbot-mcp-catalog-sync/0.1 (+https://bot.q.qq.com/wiki/)' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      const html = await response.text();
      if (cache) {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(file, html);
      }
      return html;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

export function stripHtml(html) {
  if (!html) return '';
  return decodeEntities(
    html
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function oneLine(text) {
  return stripHtml(text).replace(/\s+/g, ' ').trim();
}

function extractMain(html) {
  const start = html.indexOf('theme-default-content');
  if (start === -1) return html;
  const from = html.lastIndexOf('<div', start);
  const end = html.indexOf('<footer class="page-edit">', from);
  return html.slice(from, end === -1 ? undefined : end);
}

export function parseTable(tableHtml) {
  const headMatch = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  const allRows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) =>
    [...match[1].matchAll(/<t([hd])[^>]*>([\s\S]*?)<\/t\1>/gi)].map((cell) => oneLine(cell[2])),
  );
  let header = [];
  let body = allRows;
  if (headMatch) {
    header = [...headMatch[1].matchAll(/<t([hd])[^>]*>([\s\S]*?)<\/t\1>/gi)].map((cell) => oneLine(cell[2]));
    const headRowCount = (headMatch[1].match(/<tr[^>]*>/gi) || []).length;
    body = allRows.slice(headRowCount);
  } else if (allRows.length > 0) {
    header = allRows[0];
    body = allRows.slice(1);
  }
  return { header, rows: body.filter((row) => row.length > 0) };
}

function tokenize(mainHtml) {
  const tokens = [];
  const re =
    /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>|<table[^>]*>([\s\S]*?)<\/table>|<pre[^>]*>([\s\S]*?)<\/pre>|<p[^>]*>([\s\S]*?)<\/p>/gi;
  for (const match of mainHtml.matchAll(re)) {
    if (match[1]) {
      const text = stripHtml(match[2]).replace(/^#+\s*/, '').trim();
      tokens.push({ type: 'heading', level: Number(match[1]), text });
    } else if (match[3]) {
      tokens.push({ type: 'table', html: match[3] });
    } else if (match[4]) {
      tokens.push({ type: 'pre', html: match[4] });
    } else if (match[5]) {
      tokens.push({ type: 'p', html: match[5] });
    }
  }
  return tokens;
}

function isKeyValueTable(table) {
  const first = (table.header[0] || '').trim();
  return (first === '字段' || first === '字段名') && table.header.some((h) => h.includes('值'));
}

function isErrorTable(table) {
  return table.header.some((h) => h.includes('错误码'));
}

function isParamTable(table) {
  const header = table.header.join('|');
  return /名称|字段名|属性/.test(header) && /类型/.test(header);
}

function rowsToParams(table) {
  const indexOf = (pattern) => table.header.findIndex((h) => pattern.test(h));
  const iName = indexOf(/名称|字段名|属性/);
  const iType = indexOf(/类型/);
  const iReq = indexOf(/必填/);
  const iDesc = indexOf(/描述|说明/);
  if (iName === -1) return [];
  return table.rows
    .map((row) => ({
      name: (row[iName] || '').replace(/\s+/g, ''),
      type: iType === -1 ? '' : row[iType] || '',
      required: iReq === -1 ? undefined : /是|必填|true/i.test(row[iReq] || ''),
      description: iDesc === -1 ? '' : row[iDesc] || '',
    }))
    .filter((param) => param.name && param.name !== '名称' && param.name !== '字段名');
}

function rowsToErrors(table) {
  const iCode = table.header.findIndex((h) => h.includes('错误码'));
  const iDesc = table.header.findIndex((h) => /描述|说明/.test(h));
  const iHint = table.header.findIndex((h) => /排查|建议/.test(h));
  return table.rows
    .map((row) => ({
      code: (row[iCode] || '').trim(),
      description: (row[iDesc] || '').trim(),
      hint: iHint === -1 ? '' : (row[iHint] || '').trim(),
    }))
    .filter((item) => item.code);
}

function extractFirstJson(text) {
  const start = text.indexOf('{');
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function pathShapeMatches(template, candidate) {
  const templateParts = template.split('/').filter(Boolean);
  const candidateParts = candidate.split('?')[0].split('/').filter(Boolean);
  if (templateParts.length !== candidateParts.length) return false;
  return templateParts.every((part, index) => {
    const isVariable = part.startsWith('{');
    const candidatePart = candidateParts[index] || '';
    return isVariable ? candidatePart.length > 0 : part === candidatePart;
  });
}

/**
 * Parse a QQ wiki API page into a normalized spec.
 * @param {string} html
 * @param {{docUrl?: string, expectedPath?: string, expectedMethod?: string}} options
 */
export function parseDoc(html, options = {}) {
  const main = extractMain(html);
  const tokens = tokenize(main);
  const state = {
    title: '',
    current: '__intro__',
    sections: new Map(),
    params: [],
    pathParams: [],
    responseFields: [],
    errors: [],
    examples: [],
    models: {},
    meta: { method: '', path: '', rateLimit: '' },
    codeBlocks: [],
    texts: [],
    warnings: [],
  };
  let pendingModel = null;
  let lastParagraph = '';

  const section = (name) => {
    if (!state.sections.has(name)) state.sections.set(name, []);
    return state.sections.get(name);
  };

  // Multi-API pages (DMs, reactions, material management) document several
  // endpoints under sibling headings. Let the curated source pick a section so
  // parameters from the neighbouring endpoints are not mixed in.
  let startIndex = 0;
  let endIndex = tokens.length;
  if (options.sectionHeading) {
    const headingIndex = tokens.findIndex(
      (token) => token.type === 'heading' && token.text.includes(options.sectionHeading),
    );
    if (headingIndex === -1) {
      state.warnings.push(`section heading not found: ${options.sectionHeading}`);
    } else {
      startIndex = headingIndex;
      const level = tokens[headingIndex].level;
      for (let index = headingIndex + 1; index < tokens.length; index++) {
        if (tokens[index].type === 'heading' && tokens[index].level <= level) {
          endIndex = index;
          break;
        }
      }
    }
  }

  for (const token of tokens.slice(startIndex, endIndex)) {
    if (token.type === 'heading') {
      if (token.level === 1) state.title = token.text;
      state.current = token.text || '__intro__';
      section(state.current);
      pendingModel = null;
      lastParagraph = '';
      continue;
    }
    if (token.type === 'p') {
      const text = stripHtml(token.html).replace(/\s+/g, ' ').trim();
      if (!text) continue;
      section(state.current).push(text);
      state.texts.push(text);
      if (/^[A-Za-z_][A-Za-z0-9_.]{0,60}$/.test(text)) pendingModel = text;
      lastParagraph = text;
      continue;
    }
    if (token.type === 'pre') {
      const code = stripHtml(token.html);
      state.codeBlocks.push({ section: state.current, code, title: lastParagraph });
      lastParagraph = '';
      continue;
    }
    if (token.type === 'table') {
      const table = parseTable(token.html);
      if (isKeyValueTable(table)) {
        const pairs = new Map(table.rows.map((row) => [row[0] || '', row[1] || '']));
        if (pairs.has('HTTP URL')) state.meta.path = pairs.get('HTTP URL');
        if (pairs.has('HTTP Method')) state.meta.method = pairs.get('HTTP Method');
        const rate = [...pairs.entries()].find(([key]) => key.includes('频率限制'));
        if (rate) state.meta.rateLimit = rate[1];
      } else if (isErrorTable(table)) {
        state.errors.push(...rowsToErrors(table));
      } else if (isParamTable(table)) {
        const rows = rowsToParams(table);
        const headingIsModel =
          /^[A-Z][A-Za-z0-9_.]*$/.test(state.current) &&
          state.current !== state.title &&
          !/^(GET|POST|PUT|PATCH|DELETE)$/.test(state.current);
        if (pendingModel) {
          state.models[pendingModel] = rows;
        } else if (headingIsModel) {
          state.models[state.current] = rows;
        } else if (/响应|返回/.test(state.current)) {
          state.responseFields.push(...rows);
        } else if (/路径/.test(state.current)) {
          state.pathParams.push(...rows);
        } else {
          state.params.push(...rows);
        }
      }
      pendingModel = null;
      lastParagraph = '';
    }
  }

  // Method/path: prefer a fenced request line, and prefer the one matching the
  // curated source path (the docs also show concrete example URLs).
  const candidates = [];
  for (const source of [...state.codeBlocks.map((block) => block.code), ...state.texts]) {
    for (const match of source.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s<"'`]+)/g)) {
      candidates.push({ method: match[1], path: match[2] });
    }
  }
  const uniqueCandidates = [...new Map(candidates.map((c) => [`${c.method} ${c.path}`, c])).values()];
  let chosen;
  if (options.expectedPath) {
    chosen =
      uniqueCandidates.find(
        (c) => pathShapeMatches(options.expectedPath, c.path) && (!options.expectedMethod || c.method === options.expectedMethod),
      ) || uniqueCandidates.find((c) => pathShapeMatches(options.expectedPath, c.path));
  }
  chosen ??= uniqueCandidates[0];

  const method = (options.expectedMethod || state.meta.method || chosen?.method || '').toUpperCase();
  const rawPath = options.expectedPath || state.meta.path || chosen?.path || '';
  const [path] = rawPath.split('?');
  const chosenQuery = (chosen?.path || '').split('?')[1] || '';
  const queryString = chosenQuery || rawPath.split('?')[1] || '';
  const queryFromUrl = [];
  if (queryString) {
    for (const part of queryString.split('&')) {
      const [rawName, rawDefault = ''] = part.split('=');
      if (!rawName || rawName.startsWith('{')) continue;
      queryFromUrl.push({
        name: rawName,
        type: 'string',
        required: false,
        description: rawDefault ? `示例值：${rawDefault}` : '',
      });
    }
  }
  if (!method) state.warnings.push('missing HTTP method');
  if (!path) state.warnings.push('missing HTTP path');

  const pathNames = [...path.matchAll(/\{([^}/]+)\}/g)].map((match) => match[1]);
  const allParams = [...state.pathParams, ...state.params];
  const byName = new Map();
  for (const param of allParams) if (!byName.has(param.name)) byName.set(param.name, param);
  for (const param of queryFromUrl) if (!byName.has(param.name)) byName.set(param.name, param);

  const PATH_PARAM_LABELS = {
    guild_id: '频道（guild）ID',
    channel_id: '子频道 ID',
    user_id: '用户 ID',
    message_id: '消息 ID',
    group_openid: '群 OpenID',
    user_openid: '用户 OpenID',
    member_openid: '群成员 OpenID',
    role_id: '身份组 ID',
    schedule_id: '日程 ID',
    thread_id: '帖子 ID',
    panel_id: '指令面板 ID',
    interaction_id: '互动事件 ID',
    strategy_id: '入群审批策略 ID',
    image_id: '图片素材 ID',
    type: '表情类型（1=系统表情，2=emoji）',
    id: '表情 ID',
  };
  const pathParams = pathNames.map((name) => {
    const parsed = byName.get(name);
    return {
      name,
      type: parsed?.type || 'string',
      required: true,
      description: parsed?.description || PATH_PARAM_LABELS[name] || '路径参数',
    };
  });

  const queryParams = [];
  const bodyParams = [];
  const multipartFields = [];
  for (const param of byName.values()) {
    if (pathNames.includes(param.name)) continue;
    if (queryFromUrl.some((q) => q.name === param.name) || method === 'GET' || method === 'DELETE') {
      queryParams.push(param);
    } else if ((param.type || '').toLowerCase() === 'file') {
      multipartFields.push(param);
    } else {
      bodyParams.push(param);
    }
  }

  const responseText = ['响应', '返回']
    .map((name) => state.sections.get(name)?.join(' '))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const hintedText = options.sectionHeading
    ? [...state.sections.entries()]
        .filter(([name]) => name.includes(options.sectionHeading))
        .map(([, values]) => values.join('\n'))
        .join('\n')
    : '';
  const description = [
    hintedText,
    state.sections.get(state.title)?.join('\n'),
    state.sections.get('__intro__')?.join('\n'),
    state.sections.get('功能描述')?.join('\n'),
    state.sections.get('说明')?.join('\n'),
  ]
    .filter(Boolean)
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/^(GET|POST|PUT|PATCH|DELETE)\s+\/\S+\s*\n?/, '')
    .trim()
    .slice(0, 1600);

  const seenExamples = new Set();
  for (const block of state.codeBlocks) {
    if (!/示例|example/i.test(block.section)) continue;
    const json = extractFirstJson(block.code);
    if (!json) continue;
    const key = JSON.stringify(json);
    if (seenExamples.has(key)) continue;
    seenExamples.add(key);
    state.examples.push({
      title: block.title && block.title.length < 80 ? block.title : block.section,
      body: json,
    });
    if (state.examples.length >= 6) break;
  }

  return {
    docUrl: options.docUrl,
    title: state.title,
    description,
    method,
    path,
    rateLimit: state.meta.rateLimit,
    pathParams,
    queryParams,
    bodyParams,
    multipartFields,
    models: state.models,
    response: {
      description: responseText.slice(0, 1200),
      fields: state.responseFields,
    },
    errors: state.errors,
    examples: state.examples,
    warnings: state.warnings,
  };
}

const INTEGER_TYPES = new Set(['integer', 'int', 'int32', 'int64', 'uint32', 'uint64', 'long', 'ushort']);
const NUMBER_TYPES = new Set(['number', 'float', 'double', 'decimal']);
const BOOLEAN_TYPES = new Set(['boolean', 'bool']);
const STRING_TYPES = new Set(['string', 'str', 'url', 'timestamp', 'date']);

export function schemaForType(rawType, models = {}, options = {}) {
  const { docUrl = '', depth = 0, seen = new Set() } = options;
  const type = String(rawType || '').trim();
  if (!type) return {};
  if (type.startsWith('[]')) {
    return { type: 'array', items: schemaForType(type.slice(2), models, { ...options, depth, seen }) };
  }
  const arrayMatch = type.match(/^Array<(.+)>$/i) || type.match(/^array\[(.+)\]$/i);
  if (arrayMatch) {
    return { type: 'array', items: schemaForType(arrayMatch[1], models, { ...options, depth, seen }) };
  }
  const lower = type.toLowerCase();
  if (STRING_TYPES.has(lower)) return { type: 'string' };
  if (INTEGER_TYPES.has(lower)) return { type: 'integer' };
  if (NUMBER_TYPES.has(lower)) return { type: 'number' };
  if (BOOLEAN_TYPES.has(lower)) return { type: 'boolean' };
  if (lower === 'file' || lower === 'binary') return { type: 'string', format: 'binary' };
  if (lower === 'array') return { type: 'array', items: {} };
  if (lower === 'object' || lower === 'map') return { type: 'object', additionalProperties: true };

  const model = models[type] || models[type.replace(/^\[?\]?/, '')] || models[type.replace(/^./, (c) => c.toUpperCase())];
  if (Array.isArray(model)) {
    if (depth >= 6 || seen.has(type)) return { type: 'object', additionalProperties: true };
    const nextSeen = new Set(seen).add(type);
    return paramsToSchema(model, models, { docUrl, depth: depth + 1, seen: nextSeen });
  }
  if (model && typeof model === 'object') {
    // models.json entries are ready-made JSON Schema objects.
    return structuredClone(model);
  }
  return { type: 'object', title: type, description: `结构见文档${docUrl ? `：${docUrl}` : ''}`, additionalProperties: true };
}

export function paramsToSchema(params, models = {}, options = {}) {
  const properties = {};
  const required = [];
  for (const param of params) {
    if (!param.name) continue;
    const schema = schemaForType(param.type, models, options);
    if (param.description) schema.description = param.description;
    properties[param.name] = schema;
    if (param.required === true) required.push(param.name);
  }
  const result = { type: 'object', properties, additionalProperties: true };
  if (required.length > 0) result.required = [...new Set(required)];
  return result;
}

export function buildReadableSummary(spec) {
  const lines = [`# ${spec.name}`, spec.summary || spec.title || '', ''];
  lines.push(`${spec.method} ${spec.path}`);
  if (spec.rateLimit) lines.push(`频率限制: ${spec.rateLimit}`);
  lines.push(`只读: ${spec.readOnly ? '是' : '否'}`);
  return lines.join('\n');
}
