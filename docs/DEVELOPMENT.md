# 开发与验收

## 环境

- Node.js >= 22
- pnpm >= 10（推荐）
- TypeScript 5.9、Vitest 4

```bash
pnpm install
npm run typecheck
npm test
npm run build
npm run smoke
```

## 目录

```text
catalog/                 人工精选的 API/事件清单与覆盖修正
  sources.json           103 个 API（method/path/readOnly/docUrl）
  events.json            53 个事件（intent/分类）
  overrides.json         消息/媒体/互动等接口的描述与 schema 修正
scripts/
  lib/docs.mjs           QQ wiki HTML 解析器（含多接口分节）
  sync-catalog.mjs       生成 src/generated/{catalog,events}.json
  check-coverage.mjs     对照 sitemap 检查遗漏（CI 用）
  bootstrap-sources.mjs  上游新增接口的草稿生成
  smoke.mjs              MCP stdio 冒烟
  smoke-cli.mjs          CLI / 二维码 / MCP 兼容冒烟
src/
  cli.ts                 CLI 入口
  cli/                   参数、二维码、REPL、命令
  runtime.ts             server/CLI 共用运行时
  server.ts              MCP Server / resources / 生命周期
  config.ts              环境变量与模式
  catalog.ts             目录加载、搜索、错误解释
  client/                token、HTTP、限速、媒体上传/下载
  events/                EventStore、WebSocket Gateway、Webhook
  safety/                模式、路径围栏、审计
  tools/                 20 个 MCP 工具
  generated/             提交到仓库的离线目录
test/                    mock、固定向量、CLI/stdio 端到端
```

## 测试

当前测试不依赖真实 QQ 凭据：

- 目录/搜索、parser、配置、token 单飞与刷新；
- HTTP 错误/重试/限速、multipart、分片上传；
- 事件缓冲/长轮询、网关 identify/heartbeat、Webhook Ed25519 验签；
- 工具模式门禁、stdio 端到端；
- CLI 参数、二维码 PNG、命令分发、MCP 兼容。

```bash
npm test                 # 单元 + 端到端
npm run smoke            # MCP + CLI 冒烟
npm run check:coverage   # 需要网络，访问 bot.q.qq.com/wiki
```

## 目录更新

```bash
npm run gen
npm run check:coverage
node scripts/gen-coverage-doc.mjs
```

- `npm run gen` 会重新抓取 103 个 API 页面生成 `src/generated/*.json`；运行时不需要网络。
- `npm run bootstrap` 只输出草稿，不会覆盖人工目录。
- 详细流程见 [UPSTREAM-SYNC.md](UPSTREAM-SYNC.md)。

## 验收

```bash
npm run typecheck
npm test
npm run build
npm run smoke
npm run check:coverage
npm pack --dry-run
```

CLI 手工验收：

```bash
node dist/cli.js --help
node dist/cli.js --qr
node dist/cli.js --mcp    # 用 MCP 客户端或管道完成 initialize
node dist/cli.js          # 终端中进入交互式 CLI
```

## 发布

见 [PUBLISHING.md](PUBLISHING.md)。
