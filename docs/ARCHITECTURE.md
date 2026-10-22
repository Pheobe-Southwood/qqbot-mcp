# 架构说明

## 1. 进程模型

```
终端 (TTY)                        MCP client (stdio JSON-RPC)
    │                                      │
    ▼                                      ▼
src/cli.ts  ── 参数/QR/REPL           src/cli.ts --mcp / src/server.ts
    │                                      │
    └──────────────┬───────────────────────┘
                   ▼
            src/runtime.ts ── Catalog (src/generated/*.json)
                   │
                   ├── tools/            20 个工具，按模式过滤
                   ├── client/token.ts   AppID/Secret → access_token
                   ├── client/http.ts    URL/schema/限速/错误映射
                   ├── client/media.ts   分片上传 / multipart / 下载
                   ├── events/store.ts   环形缓冲 + 长轮询
                   ├── events/gateway.ts WebSocket 网关
                   └── events/webhook.ts Webhook 验签
```

- `qqbot-mcp` 在 TTY 中进入交互式 CLI；`--mcp` 强制 stdio MCP；非 TTY 无参数也走 MCP，兼容现有客户端。
- `src/cli.ts` 负责参数解析、二维码和 REPL；`src/server.ts` 只负责 MCP 协议、工具/资源注册和生命周期。
- 两者通过 `src/runtime.ts` 共用 token、client、事件、媒体、审计，不复制业务逻辑。
- 一个 MCP 客户端对应一个子进程；进程生命周期由客户端管理。
- **MCP 模式下 stdout 只允许 JSON-RPC**。所有日志、警告、堆栈都写 stderr；CLI 模式才向 stdout 打界面。
- 运行时**不访问网络获取目录**；`catalog.json` / `events.json` 构建时生成并提交，离线可用。
- 启动时只解析配置和目录；只有调用工具、生成带凭据的分享链接或显式开启事件流才会访问 QQ。

### 1.1 CLI 与二维码

- `src/cli/args.ts`：判定 TTY/MCP，解析 `--cli/--mcp/--qr/--no-qr`。
- `src/cli/qr.ts`：用 `qrcode` 生成 UTF-8 终端二维码和 PNG。
- `src/cli/repl.ts`：`readline/promises` 交互循环，启动时打印 banner/二维码。
- `src/cli/commands.ts`：命令分发、发送/回复向导、事件命令；内部调用现有 `callTool`，因此模式门禁、审计、限流完全一致。
- 默认二维码内容是 QQ 机器人快速创建/登录入口；`QQBOT_MCP_QR_URL` 可覆盖，PNG 权限 `0600`。
- `--qr` 一次性输出，不进入 REPL；MCP 模式绝不打印二维码，避免污染 stdout。

## 2. 模式与工具门禁

三档：`docs < read < write`。

1. `tools/list` 根据当前模式过滤（7 / 13 / 20）。
2. `tools/call` 再用 `requiredModeForTool()` 检查一次，防止客户端缓存旧列表。
3. 无凭据时配置层强制 `docs`；有凭据默认 `read`。
4. 写工具不会因为 `tools/list` 被绕过：`invoke_api`、`send_message` 等在入口就拒绝。

## 3. 目录流水线

```
catalog/sources.json ─┐
catalog/overrides.json├─ scripts/sync-catalog.mjs ─ src/generated/catalog.json
catalog/models.json  ─┘                              src/generated/events.json
catalog/events.json ─────────────────────────────────┘
```

- `sources.json`：人工确认的 103 个 API（name/aliases/category/summary/method/path/readOnly/docUrl）。
- `events.json`：53 个事件（name/category/summary/intents/docUrl）。
- `sync-catalog.mjs` 抓取/读取页面，`scripts/lib/docs.mjs` 解析：
  - 标题、描述、HTTP URL / Method、频率限制；
  - Path / Query / Body / multipart 参数表；
  - 返回字段、错误码、JSON 示例；
  - 嵌套模型（`SessionStartLimit` 等）不混入请求参数；
  - 多接口页面（私信、表情表态、素材管理）按 `sectionHeading` 只取对应分节。
- `overrides.json` 修正文档没写清的部分（消息频控、msg_type 枚举、互动 code、音频 status、旧版 patch schema）。
- `check-coverage.mjs` 对照 sitemap 检查 47 个 autogen API 页、48 个含接口的 server-inter 页、22 个 autogen 事件页；有遗漏退出码 1。
- `bootstrap-sources.mjs` 只生成草稿，避免覆盖人工判断。

## 4. 请求链路

```
tool handler
  └─ 参数解析/JSON Schema 校验
      └─ QqBotClient.request(api, {path, query, body})
          ├─ buildUrl: path 编码 + query 数组重复键
          ├─ RateLimiter: 文档 QPS/QPM → 本地滑动窗口
          ├─ TokenManager.get(): 缓存/单飞/提前 60s 刷新
          ├─ fetch(Authorization: QQBot <token>)
          ├─ 401/11241/11243 → invalidate + 刷新 + 重试一次
          ├─ GET 5xx → 300ms 后重试一次
          ├─ err_code != 0 → ApiError(code, trace_id, hint)
          └─ 304023/304024 → ok + pending_audit
      └─ 结果 JSON（text content）
```

错误映射：

- `ToolError`：参数/模式/本地文件/取消等，用户可修正。
- `ApiError`：QQ 业务错误，带 `err_code`、`http_status`、`trace_id`、`data`。
- `AuthError`：刷新后仍 401。
- `RateLimitError`：本地限速，带 `retry_after_ms`。
- `TokenError`：换取 token 失败（含 100016 等 hint）。

`catalog.explainError()` 会从所有 API 的错误码表里查描述，工具层再叠加常见码的修复建议。

## 5. Token

- `POST ${QQBOT_API_BASE}/app/getAppAccessToken`，body `{appId, clientSecret}`。
- 响应 `{access_token, expires_in}`；缓存到 `expires_in - min(60, expires_in/2)`。
- 并发调用共享同一个 in-flight Promise，避免启动时打爆 token 接口。
- 401/11241/11243 只刷新重试一次，避免死循环。
- `QQBOT_ACCESS_TOKEN` 优先；静态 token 不刷新、不访问 token 端点。
- 任何日志/工具结果都不包含 token。

## 6. 富媒体

### 6.1 群/单聊分片上传

```
prepare_{group,c2c}_upload
  body: file_type, file_size(string), file_name, md5, sha1, md5_10m
  → upload_id, block_size, parts[].presigned_url, upload_config
for each part:
  PUT presigned_url (application/octet-stream)
  finish_{group,c2c}_upload_part {upload_id, part_index, block_size, md5}
upload_{group,c2c}_file {file_type, file_name, upload_id, srv_send_msg}
  → file_info
```

- `md5_10m` = 前 10,002,432 字节的 MD5；文件更小时为全文 MD5。
- 逐片读取（`FileHandle.read`），不会把 200MB 文件整体读入内存。
- 并发取 `upload_config.concurrency`，上限 4；每片失败重试一次。
- `file_type`：1 图片（20MB 软限）、2 视频（30MB）、3 语音（20MB）、4 文件（200MB）；超软限自动降级为 4。
- 群/单聊 upload id 与 `file_info` 隔离，不能跨场景复用。

### 6.2 频道图片

`send_message` / `invoke_api` 的 `file_path` 在频道/私信场景走 `multipart/form-data`，字段名 `file_image`；对象字段序列化为 JSON 字符串。图片 URL 用 `image` 字段。

### 6.3 Markdown 图片

```
prepare_media_image {file_name,file_size,content_type,md5,sha1}
  → upload_id, presigned_url
PUT presigned_url（ETag = MD5）
complete_media_image {upload_id, md5}
  → image_id, url(qqbot-media://...), preview_url, ttl
```

单张 ≤10MB，支持 png/jpeg/gif/webp。

### 6.4 下载

- 只允许 http(s)，逐跳校验重定向。
- 拒绝 localhost、127/8、10/8、192.168/16、172.16/12、169.254/16、`.local`、`.internal`。
- 先看 `content-length`，流式写入时再次计数，超限删除半成品。
- 文件名清洗；目录 `0700`；文件 `0600`。

## 7. 事件

### 7.1 EventStore

- 环形数组，容量 `QQBOT_MCP_EVENT_BUFFER`（默认 1000），溢出丢最旧并 `dropped++`。
- 按 `id` 去重；TTL 默认 30 分钟。
- `poll` 默认消费；`peek=true` 保留；`since_seq` 过滤。
- `wait` 先查缓冲，命中立即返回；否则注册 waiter，`push` 时唤醒；超时返回 `timed_out=true`；客户端 cancel 时 reject。
- 每个事件带内部 `seq`、`receivedAt`、`shard`、`raw`。

### 7.2 WebSocket 网关

状态机：`idle → connecting → open → identifying → ready`，异常时 `reconnecting`，致命码 `fatal`。

- `get_gateway_bot` 取 `url`；`ws` 建连。
- op10 Hello → op2 Identify（`QQBot <token>`、intents、shard、properties）或 op6 Resume。
- op1 心跳，op11 ACK；ACK 超时/心跳未确认 → terminate 并重连。
- op0 dispatch：更新 seq，READY 记录 `session_id`，所有事件进 EventStore。
- op7 重连；op9 清 session 后重新 identify。
- 4006–4009 重置 session；4004 刷新 token 后重连；4004/4010–4014/4914/4915 视为致命。
- 退避 1s→30s，带抖动；`stop()` 清定时器并关闭 socket。
- 单进程一个 shard；多 shard 需多进程。

### 7.3 Webhook

- `node:http`，默认 `127.0.0.1:8787/qqbot/webhook`。
- `op=13`：不验签，用 AppSecret 派生 Ed25519 私钥，签 `event_ts + plain_token`，返回 `{plain_token, signature}`。
- 普通事件：校验 `X-Signature-Ed25519` / `X-Signature-Timestamp`，消息为 `timestamp + rawBody`。
- 通过后 `op=0` 写 EventStore，统一回 `{op:12,d:{}}`。
- 验签失败 401；body 上限 1MB；非 POST 405；错误路径 404。
- 公网入口用 Nginx/Caddy 反代，必须原样转发 body 与签名头。

## 8. 安全边界

| 边界 | 措施 |
| --- | --- |
| 模式 | docs/read/write，工具列表 + 调用双重检查 |
| 本地文件 | `QQBOT_MCP_UPLOAD_ROOT` realpath 围栏；拒绝目录/符号链接逃逸 |
| 下载 | SSRF 黑名单、重定向逐跳校验、大小上限 |
| 日志 | stdout 仅 JSON-RPC；不打印 secret/token |
| Webhook | Ed25519 验签；失败不写缓冲 |
| 审计 | 可选 JSONL；默认不记录正文；secret 键脱敏 |
| 重试 | 写操作不自动重试；GET 仅一次 5xx 重试 |

## 9. 扩展点

- 新 API：`catalog/sources.json` → `npm run gen` → `npm run check:coverage`。
- 文档没写清：`catalog/overrides.json` 补 description/schema/notes。
- 新事件：`catalog/events.json`；intent 位在 `src/config.ts` 的 `INTENT_BITS`。
- 新工具：`src/tools/index.ts` 加定义 + handler，并在 `src/safety/mode.ts` 登记所需模式。
- 自定义传输：实现 `EventStore.push` 的输入即可（事件只需 id/type/data）。
