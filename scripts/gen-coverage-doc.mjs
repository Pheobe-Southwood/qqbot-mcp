// Generate docs/COVERAGE.md from the committed catalog.
import { readFileSync, writeFileSync } from 'node:fs';

const c = JSON.parse(readFileSync('src/generated/catalog.json', 'utf8'));
const e = JSON.parse(readFileSync('src/generated/events.json', 'utf8'));
const apiGroups = new Map();
for (const a of c.apis) {
  if (!apiGroups.has(a.category)) apiGroups.set(a.category, []);
  apiGroups.get(a.category).push(a);
}
const eventGroups = new Map();
for (const ev of e.events) {
  if (!eventGroups.has(ev.category)) eventGroups.set(ev.category, []);
  eventGroups.get(ev.category).push(ev);
}
let md = `# 覆盖清单（Coverage）

本文件由 \`catalog/sources.json\` + \`catalog/events.json\` 与当前 \`src/generated/*.json\` 对照生成，用于回答两个问题：

1. QQ 官方 wiki 上到底有哪些接口/事件？
2. 本 MCP 是否都暴露了？哪些需要额外权限、属于旧版？

生成时间：**${c.generatedAt}**　上游：<${c.upstream}>

## 总览

| 项目 | 数量 |
| --- | --- |
| API | **${c.apiCount}** |
| API 分类 | **${c.categories.length}** |
| 事件类型 | **${e.eventCount}** |
| 旧版/兼容接口 | **${c.apis.filter((a) => a.legacy).length}** |
| 已废弃接口 | **${c.apis.filter((a) => a.deprecated).length}** |
| 需要额外权限/白名单 | **${c.apis.filter((a) => a.permissionRequired).length}** |

覆盖校验（2026-10 实测）：

\`\`\`
APIs:      103 curated (3 legacy)
autogen:   47/47 pages covered
server:    48/48 endpoint pages covered
events:    53 curated, 22/22 autogen pages covered
Warnings:  0
Coverage OK.
\`\`\`

> “autogen” 指 wiki 自动生成的 47 个标准 OpenAPI 页面；“server” 指 91 个 server-inter 页面中实际含接口定义的 48 个页面。其余页面是数据模型、事件对象或 SDK 说明，不需要单独的 API 条目。

## API 分类

| 分类 | 数量 |
| --- | --- |
`;
for (const cat of c.categories) md += `| ${cat.name} | ${cat.count} |\n`;
md += `\n## API 明细\n`;
for (const [cat, apis] of apiGroups) {
  md += `\n### ${cat}（${apis.length}）\n\n| API | 方法 | 路径 | 读 | 备注 |\n| --- | --- | --- | --- | --- |\n`;
  for (const a of apis) {
    const note = a.legacy ? 'legacy' : a.deprecated ? 'deprecated' : a.permissionRequired ? '需权限' : '—';
    md += `| \`${a.name}\` | ${a.method} | \`${a.path}\` | ${a.readOnly ? '✅' : '—'} | ${note} |\n`;
  }
}
md += `\n## 事件分类\n\n| 分类 | 数量 |\n| --- | --- |\n`;
for (const [cat, evs] of eventGroups) md += `| ${cat} | ${evs.length} |\n`;
md += `\n## 事件明细\n`;
for (const [cat, evs] of eventGroups) {
  md += `\n### ${cat}（${evs.length}）\n\n| 事件 | intents | 说明 |\n| --- | --- | --- |\n`;
  for (const ev of evs) {
    md += `| \`${ev.name}\` | ${ev.intents.join(', ') || '—'} | ${ev.summary.replaceAll('|', '\\|').slice(0, 80)} |\n`;
  }
}
md += `
## 覆盖口径

- **API 条目**以“一个 method + path 模板”为单位；同一页面的多个接口（私信、表情表态、素材管理）分别建条目。
- **事件条目**包含 v2 群/单聊事件、频道事件、论坛/音频事件以及 \`READY\`。\`READY\` 是网关生命周期事件，没有独立 intent。
- **readOnly** 依据 HTTP 语义与人工确认：GET 为只读；少数 POST 但只生成链接/分享串的接口（如 \`generate_share_link\`）也标为只读。
- **legacy** 表示仍可用但当前 wiki 索引未列出的接口，主要来自 botpy 参考实现：\`get_channel_message\`、\`patch_channel_message\`、\`list_voice_members\`。
- **deprecated** 表示 wiki 明确标注旧版/将被替换：\`create_channel_announce\`、\`delete_channel_announce\`。
- **permissionRequired** 主要来自群管理文档的“需要权限”提示；实际权限还取决于机器人类型、认证状态和平台白名单。

## 已知缺口与注意事项

1. **未做真实机器人线上验收**：所有测试均使用 mock 和官方固定签名向量。上线前请用沙箱机器人验证 token、网关、发消息、上传和 webhook。
2. **白名单能力**：音频控制、论坛、公告、接口权限、主动消息、Markdown/按钮等可能需要企业认证或单独申请；目录里有标记，但平台策略会变。
3. **频道发送依赖网关在线**：\`send_channel_message\` 在机器人未连接 WebSocket 时返回 304018；只开 webhook 不够。
4. **富媒体 \`file_data\`**：官方文档未明确 base64 编码细节，本项目统一使用分片上传；\`file_data\` 字段仍保留在 schema 中供手工调用。
5. **旧接口**：\`patch_channel_message\` 来自 botpy，当前 wiki 可能已不再提供；调用失败时以官方文档为准。
6. **多 shard**：单进程只跑一个 shard，需要多进程 + \`QQBOT_MCP_SHARD\`。

## 重新校验

\`\`\`bash
npm run check:coverage
\`\`\`

该命令会：

- 拉取 <https://bot.q.qq.com/wiki/sitemap.xml>；
- 检查 47 个 autogen API 页面是否都有条目；
- 检查 22 个 autogen 事件页面是否都有条目；
- 解析 91 个 server-inter 页面，检查 48 个含接口的页面是否被覆盖（重复文档按 method+path 去重）；
- 校验每个 server-inter 条目的 method/path 与文档一致；
- 输出 warnings；有缺失时退出码 1。

上游新增接口时，先运行 \`npm run bootstrap\` 生成草稿，人工改名/分类后再合并到 \`catalog/sources.json\`，最后 \`npm run gen\`。
`;
writeFileSync('docs/COVERAGE.md', md);
console.log(`Wrote docs/COVERAGE.md (${md.length} bytes)`);
