// Verify that the curated catalog still covers every current API/event doc page
// on bot.q.qq.com/wiki. Exit code 1 means docs were added/removed upstream.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDoc, parseDoc } from './lib/docs.mjs';

const ROOT = process.cwd();
const sources = JSON.parse(readFileSync(join(ROOT, 'catalog', 'sources.json'), 'utf8'));
const eventSources = JSON.parse(readFileSync(join(ROOT, 'catalog', 'events.json'), 'utf8'));

const SITEMAP_URL = 'https://bot.q.qq.com/wiki/sitemap.xml';
const sitemap = await (await fetch(SITEMAP_URL, { signal: AbortSignal.timeout(30_000) })).text();
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
const autogenApiUrls = urls.filter((url) => /\/autogen\/api\/[^/]+\.html$/.test(url));
const autogenEventUrls = urls.filter((url) => /\/autogen\/event\/[^/]+\.html$/.test(url));
const serverInterUrls = urls.filter((url) => /\/server-inter\/.+\.html$/.test(url));

const sourceByDoc = new Map();
for (const source of sources.apis) {
  if (!sourceByDoc.has(source.docUrl)) sourceByDoc.set(source.docUrl, []);
  sourceByDoc.get(source.docUrl).push(source);
}
const eventByDoc = new Map(eventSources.events.map((event) => [event.docUrl, event]));

const problems = [];
const warnings = [];

// 1. every autogen API page has a curated source
for (const url of autogenApiUrls) {
  if (!sourceByDoc.has(url)) problems.push(`missing API source for ${url}`);
}
// 2. every autogen event page has an event entry
for (const url of autogenEventUrls) {
  if (!eventByDoc.has(url)) problems.push(`missing event source for ${url}`);
}

// 3. every server-inter page that documents an endpoint is represented
let serverPagesWithEndpoints = 0;
let coveredServerPages = 0;
for (const url of serverInterUrls) {
  try {
    const html = await loadDoc(url);
    const parsed = parseDoc(html, { docUrl: url });
    if (!parsed.method || !parsed.path) continue;
    serverPagesWithEndpoints++;
    const matched = sourceByDoc.get(url) || [];
    const endpointCovered = sources.apis.some(
      (source) => source.method === parsed.method && source.path === parsed.path,
    );
    if (matched.length === 0 && !endpointCovered) {
      problems.push(`missing API source for server-inter page ${url} (${parsed.method} ${parsed.path})`);
    } else if (matched.length === 0) {
      coveredServerPages++;
    } else {
      coveredServerPages++;
      // Validate each curated source on this page against the docs.
      for (const source of matched) {
        const scoped = source.sectionHeading
          ? parseDoc(html, { docUrl: url, expectedPath: source.path, expectedMethod: source.method, sectionHeading: source.sectionHeading })
          : parsed;
        if (scoped.method !== source.method) {
          warnings.push(`${source.name}: method ${source.method} vs docs ${scoped.method} (${url})`);
        }
        if (scoped.path !== source.path) {
          warnings.push(`${source.name}: path ${source.path} vs docs ${scoped.path} (${url})`);
        }
      }
    }
  } catch (error) {
    warnings.push(`could not inspect ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 4. autogen sources should point at a real autogen page
for (const source of sources.apis) {
  if (source.legacy) continue;
  if (/\/autogen\/api\//.test(source.docUrl) && !urls.includes(source.docUrl)) {
    problems.push(`source ${source.name} points at a missing doc page ${source.docUrl}`);
  }
  if (/\/server-inter\//.test(source.docUrl) && !urls.includes(source.docUrl)) {
    problems.push(`source ${source.name} points at a missing doc page ${source.docUrl}`);
  }
}

const legacy = sources.apis.filter((source) => source.legacy).length;
const autogenCovered = autogenApiUrls.filter((url) => sourceByDoc.has(url)).length;
const eventCovered = autogenEventUrls.filter((url) => eventByDoc.has(url)).length;
const serverCoverage = `${coveredServerPages}/${serverPagesWithEndpoints}`;

console.log('QQbot-MCP catalog coverage');
console.log(`  APIs:      ${sources.apis.length} curated (${legacy} legacy)`);
console.log(`  autogen:   ${autogenCovered}/${autogenApiUrls.length} pages covered`);
console.log(`  server:    ${serverCoverage} endpoint pages covered`);
console.log(`  events:    ${eventSources.events.length} curated, ${eventCovered}/${autogenEventUrls.length} autogen pages covered`);
console.log(`  Warnings:  ${warnings.length}`);
for (const warning of warnings.slice(0, 20)) console.log(`    - ${warning}`);
if (warnings.length > 20) console.log(`    … and ${warnings.length - 20} more`);

if (problems.length > 0) {
  console.error(`\nCoverage FAILED (${problems.length} missing/blocking issues):`);
  for (const problem of problems.slice(0, 50)) console.error(`  - ${problem}`);
  if (problems.length > 50) console.error(`  … and ${problems.length - 50} more`);
  process.exit(1);
}
console.log('\nCoverage OK.');
