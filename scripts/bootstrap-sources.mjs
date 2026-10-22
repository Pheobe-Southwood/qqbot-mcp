// Bootstrap a draft of catalog/sources.json from the live wiki.
// It never overwrites the curated catalog: output goes to stdout, or to
// catalog/sources.draft.json with --write. Use it after upstream doc changes,
// then copy the entries you want into catalog/sources.json by hand.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDoc, parseDoc } from './lib/docs.mjs';

const ROOT = process.cwd();
const sourcesPath = join(ROOT, 'catalog', 'sources.json');
const sources = existsSync(sourcesPath) ? JSON.parse(readFileSync(sourcesPath, 'utf8')) : { apis: [] };
const knownDocUrls = new Set(sources.apis.map((api) => api.docUrl));
const knownEndpoints = new Set(sources.apis.map((api) => `${api.method} ${api.path}`));

const sitemap = await (await fetch('https://bot.q.qq.com/wiki/sitemap.xml', { signal: AbortSignal.timeout(30_000) })).text();
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
const autogenApiUrls = urls.filter((url) => /\/autogen\/api\/[^/]+\.html$/.test(url));
const serverInterUrls = urls.filter((url) => /\/server-inter\/.+\.html$/.test(url));

// Category map from the autogen index page.
const indexHtml = await loadDoc('https://bot.q.qq.com/wiki/develop/api-v2/autogen/');
const categoryByUrl = new Map();
for (const match of indexHtml.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h[23]|$)/g)) {
  const category = match[1].replace(/<[^>]+>/g, '').replace(/^#/, '').trim();
  for (const link of match[2].matchAll(/href="([^"]+)"[^>]*>([A-Z]+)\s+([^<]+)</g)) {
    categoryByUrl.set(`https://bot.q.qq.com${link[1]}`, category);
  }
}

const drafts = [];
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
for (const url of autogenApiUrls) {
  if (knownDocUrls.has(url)) continue;
  const html = await loadDoc(url);
  const parsed = parseDoc(html, { docUrl: url });
  if (!parsed.method || !parsed.path) continue;
  const last = parsed.path.split('/').filter(Boolean).slice(-2).join('_');
  drafts.push({
    name: `todo_${slug(last)}`,
    aliases: [],
    category: categoryByUrl.get(url) || '未分类',
    summary: parsed.title || parsed.description.slice(0, 60) || 'TODO',
    method: parsed.method,
    path: parsed.path,
    readOnly: parsed.method === 'GET',
    docUrl: url,
    todo: 'rename, set category/readOnly, add aliases',
  });
}
for (const url of serverInterUrls) {
  if (knownDocUrls.has(url)) continue;
  const html = await loadDoc(url);
  const parsed = parseDoc(html, { docUrl: url });
  if (!parsed.method || !parsed.path) continue;
  if (knownEndpoints.has(`${parsed.method} ${parsed.path}`)) continue;
  const last = parsed.path.split('/').filter(Boolean).slice(-2).join('_');
  drafts.push({
    name: `todo_${slug(last)}`,
    aliases: [],
    category: '未分类',
    summary: parsed.title || 'TODO',
    method: parsed.method,
    path: parsed.path,
    readOnly: parsed.method === 'GET',
    docUrl: url,
    todo: 'rename, set category/readOnly, add aliases',
  });
}

const output = `${JSON.stringify({ note: 'Draft only — review before merging into sources.json', apis: drafts }, null, 2)}\n`;
if (process.argv.includes('--write')) {
  writeFileSync(join(ROOT, 'catalog', 'sources.draft.json'), output);
  console.error(`Wrote ${drafts.length} draft entries to catalog/sources.draft.json`);
} else {
  console.log(output);
}
console.error(`Found ${drafts.length} uncovered endpoints.`);
