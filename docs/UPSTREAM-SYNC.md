# 上游同步与目录维护

QQ 机器人 wiki 会新增/调整接口。目录不是运行时抓取，而是**构建时同步、运行时离线**；因此需要一套可重复的同步流程。

## 1. 数据文件

| 文件 | 作用 |
| --- | --- |
| `catalog/sources.json` | 人工确认的 API 清单（name/aliases/category/summary/method/path/readOnly/docUrl/sectionHeading?） |
| `catalog/events.json` | 人工确认的事件清单（name/category/summary/intents/docUrl） |
| `catalog/models.json` | 文档里复用的数据结构 JSON Schema（MessageMarkdown、Keyboard、MediaInfo 等） |
| `catalog/overrides.json` | 覆盖文档默认解析结果（description/bodySchema/notes 等） |
| `src/generated/catalog.json` | 运行时目录（提交到仓库） |
| `src/generated/events.json` | 运行时事件目录（提交到仓库） |

`src/generated/*` 只由 `npm run gen` 生成，不手改。

## 2. 新增一个 API

1. 在 <https://bot.q.qq.com/wiki/> 找到页面，确认 method + path。
2. 在 `catalog/sources.json` 的 `apis` 数组加：

```json
{
  "name": "send_group_message",
  "aliases": ["post_group_message", "send_group_msg"],
  "category": "群聊消息",
  "summary": "发送群聊消息",
  "method": "POST",
  "path": "/v2/groups/{group_openid}/messages",
  "readOnly": false,
  "docUrl": "https://bot.q.qq.com/wiki/develop/api-v2/autogen/api-v2/groups/group_openid/messages.post.html"
}
```

字段说明：

- `name`：MCP/工具使用的稳定 snake_case 名称，避免改名（改名会破坏 prompt/脚本）。
- `aliases`：中文习惯叫法、旧名、botpy 方法名，便于搜索。
- `category`：必须与 `list_categories` 中的分类一致；新增分类会自动出现。
- `readOnly`：GET 一般 true；生成分享链接等无副作用 POST 也可 true；其余 false。写 API 只在 write 模式可调用。
- `docUrl`：用于同步和排错；legacy 接口可指向 botpy/github。
- `legacy` / `deprecated` / `permissionRequired`：可选，用于标记旧接口、废弃接口、需白名单。
- `sectionHeading`：同一页面有多个接口时必填，值是接口所属的二级/三级标题（不含 `#`），例如 `申请图片上传`、`发送私信`、`机器人发表表情表态`。解析器只取该分节直到下一个同级标题，避免参数串台。

3. 如果文档没写清参数/枚举/频控，在 `catalog/overrides.json` 加：

```json
{
  "apis": {
    "send_group_message": {
      "description": "……",
      "bodySchema": {
        "properties": {
          "msg_type": { "type": "integer", "enum": [0, 2, 7] }
        },
        "required": ["msg_type"]
      },
      "notes": ["同一 msg_id 多次回复需递增 msg_seq。"]
    }
  }
}
```

`sync-catalog.mjs` 的合并顺序：文档解析 → override 的 `description/bodySchema/querySchema/pathSchema/notes` → 从 schema 反向补齐 `bodyParams/queryParams/pathParams` → 生成 `inputSchema`。如果 override 的 schema 里多了字段，`get_api` 的参数列表也会同步出现。

4. 运行：

```bash
npm run gen
npm run check:coverage
npm test
```

5. 检查 `src/generated/catalog.json` 中该条目的 method/path/body/response/errors 是否符合预期。

## 3. 新增一个事件

在 `catalog/events.json` 的 `events` 数组加：

```json
{
  "name": "GROUP_AT_MESSAGE_CREATE",
  "category": "群聊消息",
  "summary": "用户在群里 @机器人 时收到消息",
  "intents": ["GROUP_AND_C2C_EVENT"],
  "docUrl": "https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_at_message_create.html"
}
```

- `intents` 必须是 `src/config.ts` 中 `INTENT_BITS` 的键；新增 intent 时同时更新该常量、`docs/CONFIGURATION.md` 配置表和测试。
- `payload`、`payloadSchema`、`examples` 由解析器从文档生成；解析不到时 `payloadNote` 会提示看文档。
- `READY` 没有独立 intent，`intents: []`。

## 4. 解析器做了什么

`scripts/lib/docs.mjs`：

- 只取 `<div class="theme-default-content">` 到页脚之间的正文。
- 按文档顺序遍历 `h1-h6/table/pre/p`。
- 识别：
  - 标题、`功能描述`/`说明` 作为描述；
  - `字段/值` 基础信息表 → method/path/rateLimit；
  - `名称|字段名|属性` + `类型` 参数表 → path/query/body/multipart；
  - `返回|响应` 下的字段表 → response.fields；
  - `错误码` 表 → errors；
  - `<pre>` JSON → examples；
  - 标题为类型名（如 `SessionStartLimit`）的后续表 → models，不混入请求参数；
  - URL 里的 `?cursor=` → query 参数；
  - 多接口页面按 `sectionHeading` 截取分节。
- 类型映射：`string/uint64/int/bool/array/file/binary/object/自定义类型`；自定义类型从 `models` 或 `catalog/models.json` 取 schema。

已知限制：

- 页面结构大改（class 名、表格列名、非 VitePress 渲染）会导致解析为空；`check-coverage` 会报 missing。
- 某些页面把参数写在正文/示例里而不是表格（如旧版 `patch_channel_message`、音频控制），需要 override。
- 文档里的具体 ID 示例（`/channels/123456/...`）会参与候选路径匹配；解析器优先用 `expectedPath`，不会把示例当成接口路径。
- 错误码表可能只给链接（如频道消息页），此时 `errors` 为空，工具层仍会用通用 hint。

## 5. 上游巡检

```bash
npm run check:coverage
```

判定逻辑：

1. sitemap 中 47 个 `/autogen/api/` 页面必须都有 source。
2. 22 个 `/autogen/event/` 页面必须都有 event。
3. 91 个 `/server-inter/` 页面逐个解析；48 个含 method+path 的页面必须有 source，或该 method+path 已被其他页面覆盖（重复文档）。
4. source 的 method/path 必须与文档解析结果一致。
5. 缺失退出码 1，warnings 打印前 20 条。

新增接口时先生成草稿：

```bash
npm run bootstrap            # 输出 JSON 到 stdout
npm run bootstrap -- --write # 写 catalog/sources.draft.json（不覆盖正式目录）
```

草稿名称是 `todo_*`，需要人工改成稳定名称、分类、readOnly，再合并。

## 6. 变更记录

- 2026-10：建立目录（103 API / 53 事件 / 21 分类）；覆盖 47 autogen API 页、48 server-inter 接口页、22 autogen 事件页。
- 解析器修复：`属性` 表头、嵌套模型标题、URL query、多接口分节。
- override 补齐：消息频控、msg_type 枚举、流式参数、互动 code、群审批/黑名单/禁言、音频 status、DM/表情/素材描述。

## 7. 发布前检查

```bash
npm run typecheck
npm test
npm run build
npm run smoke
npm run check:coverage
```

确认：

- `src/generated/*.json` 已更新并提交；
- `docs/COVERAGE.md` 已用 `node scripts/gen-coverage-doc.mjs` 重新生成；
- README/docs 的 API 数、事件数与生成文件一致；
- 没有把 AppSecret/token 写进任何文件。
