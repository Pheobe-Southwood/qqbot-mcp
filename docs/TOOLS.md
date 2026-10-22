# 工具参考

启动 MCP Server：`qqbot-mcp --mcp`（无参数且非 TTY 时也自动进入 MCP）。

所有工具都返回 MCP `content: [{type:"text", text:"<JSON>"}]`；失败时额外 `isError: true`。JSON 顶层通常有 `ok`。

## 模式可见性

| 工具 | docs | read | write |
| --- | :---: | :---: | :---: |
| `list_apis` | ✅ | ✅ | ✅ |
| `get_api` | ✅ | ✅ | ✅ |
| `search_apis` | ✅ | ✅ | ✅ |
| `list_categories` | ✅ | ✅ | ✅ |
| `list_event_types` | ✅ | ✅ | ✅ |
| `get_event_type` | ✅ | ✅ | ✅ |
| `bot_status` | ✅ | ✅ | ✅ |
| `query_api` | — | ✅ | ✅ |
| `poll_events` | — | ✅ | ✅ |
| `wait_events` | — | ✅ | ✅ |
| `clear_events` | — | ✅ | ✅ |
| `event_stream_status` | — | ✅ | ✅ |
| `download_attachment` | — | ✅ | ✅ |
| `invoke_api` | — | — | ✅ |
| `send_message` | — | — | ✅ |
| `reply_message` | — | — | ✅ |
| `upload_media` | — | — | ✅ |
| `recall_message` | — | — | ✅ |
| `start_event_stream` | — | — | ✅ |
| `stop_event_stream` | — | — | ✅ |

---

## 文档工具

### `list_apis`

```json
{ "category": "群聊消息", "read_only": false, "include_legacy": true, "keyword": "撤回" }
```

全部可选。返回 `{count,total,categories,apis[]}`；`apis[]` 是轻量条目（name/category/summary/method/path/readOnly/aliases/legacy/deprecated/permissionRequired/rateLimit）。

### `get_api`

```json
{ "name": "send_group_message" }
```

`name` 支持别名、大小写不敏感。返回完整 `api`：描述、notes、方法/路径、读写/legacy/权限标记、`params.{path,query,body,multipart}`、`inputSchema/bodySchema/querySchema/pathSchema`、`response.fields`、`errors[]`、`examples[]`、`docUrl`。

### `search_apis`

```json
{ "query": "撤回", "limit": 20 }
```

按 name/alias 精确、前缀、包含、path、summary、description 打分。返回 `{query,count,hits[]}`，每条带 `score`。

### `list_categories`

无参数。返回 `{categories:[{name,count}]}`。

### `list_event_types`

```json
{ "intent": "GROUP_AND_C2C_EVENT", "category": "群聊消息", "keyword": "消息" }
```

全部可选；`intent` 必须是 intent 名。返回 `{count,events[]}`，每条含 name/category/summary/docUrl/intents/intentBits。

### `get_event_type`

```json
{ "name": "GROUP_AT_MESSAGE_CREATE" }
```

返回 `{event:{name,category,summary,description,docUrl,intents,intentBits,payload[],payloadSchema,examples[]}}`。

### `bot_status`

```json
{ "probe_network": true }
```

- `probe_network=false`（默认）：只读本地状态，不访问 QQ。
- `probe_network=true` 且非 docs：额外调用 `get_gateway_bot`，返回 `probe.ok/data` 或错误。
- 返回 `mode`、`credentials`（source/valid/expiresAt，不含 token）、`catalog`、`config`、`events`。

---

## 读取工具

### `query_api`

```json
{ "api": "get_gateway_bot", "path": {}, "query": {}, "body": {} }
```

- 仅接受 `readOnly=true` 的 API；写 API 会提示改用 `invoke_api`。
- 调用前按 path/query/body schema 校验必填与基本类型。
- 返回 `{ok,api,http_status,trace_id?,data}`。

### `poll_events`

```json
{ "types": ["GROUP_AT_MESSAGE_CREATE"], "limit": 20, "peek": false, "since_seq": 0 }
```

- 默认消费返回的事件；`peek=true` 保留。
- 返回 `{ok,transport,count,events[],remaining,dropped,last_seq,gateway_state,hint?}`。
- 事件传输未开启时返回可执行的错误，而不是空结果。

### `wait_events`

```json
{ "types": ["C2C_MESSAGE_CREATE"], "timeout_ms": 30000, "limit": 20, "peek": false }
```

- 先返回缓冲命中；否则等待新事件。
- `timeout_ms` 100–300000，默认 30000。
- 超时返回 `timed_out:true` 和空数组；客户端取消时工具失败（cancel）。
- 返回 `{ok,transport,count,events,remaining,dropped,last_seq,timed_out,waited_ms,hint?}`。

### `clear_events`

无参数。返回 `{cleared}`。只清缓冲，不停传输。

### `event_stream_status`

无参数。返回 `{transport,autostart,intents,shard,gateway,webhook,store}`。

- `gateway`: state/session_id/last_seq/shard/intents/attempts/last_error/ready/bot。
- `webhook`: state/listening/host/port/path/requests/verified/rejected/validations。
- `store`: buffered/capacity/ttl_ms/last_seq/dropped/duplicates/expired/waiters/by_type/oldest/newest。

### `download_attachment`

```json
{ "url": "https://...", "filename": "image.png", "max_bytes": 10485760 }
```

返回 `{ok,path,size,content_type,url,sha256}`。拒绝内网/非 http(s)；`max_bytes` 不能超过配置上限。

---

## 写入工具

### `invoke_api`

```json
{
  "api": "send_group_message",
  "path": { "group_openid": "G" },
  "query": {},
  "body": { "msg_type": 0, "content": "hi" },
  "execution": { "file_path": "a.png", "file_type": 1, "srv_send_msg": false }
}
```

- `api/path/query/body` 必填 `api`；path/query/body 按目录 schema 校验。
- `execution.file_path` 的特殊处理：
  - `upload_group_file` / `upload_c2c_file`：走完整分片上传，返回 `{api,upload}`。
  - `send_group_message` / `send_c2c_message`：先上传，再自动填 `msg_type=7` + `media.file_info`。
  - `send_channel_message` / `send_dm_message`：读取本地图片，走 multipart `file_image`。
  - 其他 API：报错并提示支持的接口。
- 普通调用返回 `{ok,api,http_status,trace_id?,pending_audit?,data}`。

### `send_message`

```json
{
  "target": { "type": "group", "id": "GROUP_OPENID" },
  "text": "hello",
  "markdown": "## hi",
  "file_path": "report.pdf",
  "file_url": "https://example.com/a.mp4",
  "image_url": "https://example.com/a.png",
  "ark": {},
  "embed": {},
  "keyboard": {},
  "message_reference": { "message_id": "M" },
  "msg_id": "EVENT_MSG_ID",
  "event_id": "EVENT_ID",
  "msg_seq": 1,
  "input_notify": { "input_type": 1, "input_second": 5 },
  "file_type": 4
}
```

`target.type`：

| 类型 | `id` | 实际 API | 本地文件 |
| --- | --- | --- | --- |
| `c2c` | user openid | `send_c2c_message` | 分片富媒体 |
| `group` | group openid | `send_group_message` | 分片富媒体 |
| `channel` | channel_id | `send_channel_message` | multipart `file_image` |
| `dm` | dms guild_id | `send_dm_message` | multipart `file_image` |

行为：

- C2C/群：有文件先发媒体（`msg_type=7`），再发文本/Markdown（如有），自动递增 `msg_seq`；只允许 text/markdown/keyboard/message_reference/media，传 `ark/embed/image_url` 会报错。
- 频道/私信：`text→content`、`markdown→markdown`、`file_url→image`（未给 file_path 时）、`ark/embed/keyboard/message_reference` 原样传；本地文件走 multipart。
- 至少提供一个内容源，否则报错。`input_notify` 是独立的 `msg_type=6` 消息，不能和 text/markdown/媒体同时发送。
- 媒体消息只携带 `media`/回复字段；`keyboard`、`message_reference` 只附加到文本/Markdown 消息。
- `msg_id`/`event_id` 用于被动回复；不传 `msg_seq` 时默认 1，多条自动递增。
- 返回 `{ok,target,sent:[{api,data,http_status,trace_id?}],upload?,file?}`。

### `reply_message`

与 `send_message` 相同的参数，但必须有 `msg_id` 或 `event_id`。适合事件驱动的被动回复。

### `upload_media`

```json
{
  "target": { "type": "group", "id": "G" },
  "file_path": "a.pdf",
  "file_type": 4,
  "srv_send_msg": false,
  "markdown_image": false
}
```

- `markdown_image=true`：只支持 `file_path`，≤10MB 图片，返回 `{target,markdown_image:{image_id,url,preview_url,ttl,markdown}}`。
- 否则 `file_path` 或 `file_url` 二选一，返回 `{target,upload}`；`srv_send_msg=true` 时上传后直接发送。
- c2c/group 之外的目标报错。

### `recall_message`

```json
{ "target": { "type": "group", "id": "G" }, "message_id": "M", "hidetip": false }
```

路由：

| target | API | 备注 |
| --- | --- | --- |
| c2c | `recall_c2c_message` | 只能撤回机器人自己的消息 |
| group | `recall_group_message` | 超过 2 分钟不可撤回 |
| channel | `recall_channel_message` | `hidetip` 有效 |
| dm | `recall_dm_message` | `hidetip` 有效 |

### `start_event_stream`

```json
{
  "transport": "websocket",
  "intents": ["GROUP_AND_C2C_EVENT", "INTERACTION"],
  "shard": [0, 1],
  "wait_ready_ms": 10000
}
```

- `transport` 默认 `websocket`（若配置了 webhook 则沿用配置）。
- `intents` 支持名称数组、逗号字符串、数字位掩码或 `all`。
- `shard` 必须 `0 <= id < count`。
- webhook 额外支持 `host/port/path`。
- 成功后会更新运行期 `eventTransport`，随后 `poll_events`/`wait_events` 可用。
- 返回 `{ok,transport,gateway}` 或 `{ok,transport,webhook}`。

### `stop_event_stream`

无参数。停止网关与 webhook，`eventTransport` 置回 `off`；缓冲保留。

---

## 常见错误

| 场景 | 错误 |
| --- | --- |
| 模式不足 | `Tool "invoke_api" requires write mode...` |
| 未知 API | `Unknown API "..." Did you mean: ...` |
| 缺少 path 参数 | `Missing required path parameter(s) ...` |
| 本地文件越界 | `Refusing to read a file outside QQBOT_MCP_UPLOAD_ROOT` |
| 事件未开启 | `Event transport is off.` + 启动提示 |
| 被动回复过期 | `40034005` / `40034128` + hint |
| 频道未连网关 | `304018` + 启动网关提示 |
| 重复回复 | `40054005` + 递增 msg_seq 提示 |
