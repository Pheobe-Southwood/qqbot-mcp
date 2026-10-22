# 覆盖清单（Coverage）

本文件由 `catalog/sources.json` + `catalog/events.json` 与当前 `src/generated/*.json` 对照生成，用于回答两个问题：

1. QQ 官方 wiki 上到底有哪些接口/事件？
2. 本 MCP 是否都暴露了？哪些需要额外权限、属于旧版？

生成时间：**2026-10-22T14:46:43.340Z**　上游：<https://bot.q.qq.com/wiki/develop/api-v2/>

## 总览

| 项目 | 数量 |
| --- | --- |
| API | **103** |
| API 分类 | **21** |
| 事件类型 | **53** |
| 旧版/兼容接口 | **3** |
| 已废弃接口 | **2** |
| 需要额外权限/白名单 | **7** |

覆盖校验（2026-10 实测）：

```
APIs:      103 curated (3 legacy)
autogen:   47/47 pages covered
server:    48/48 endpoint pages covered
events:    53 curated, 22/22 autogen pages covered
Warnings:  0
Coverage OK.
```

> “autogen” 指 wiki 自动生成的 47 个标准 OpenAPI 页面；“server” 指 91 个 server-inter 页面中实际含接口定义的 48 个页面。其余页面是数据模型、事件对象或 SDK 说明，不需要单独的 API 条目。

## API 分类

| 分类 | 数量 |
| --- | --- |
| 机器人 | 3 |
| 网关 | 2 |
| 单聊消息 | 6 |
| 群聊消息 | 5 |
| 群管理 | 17 |
| 频道消息 | 7 |
| 频道管理 | 13 |
| 身份组 | 6 |
| 子频道权限 | 4 |
| 接口权限 | 2 |
| 禁言 | 3 |
| 公告 | 4 |
| 音频 | 3 |
| 论坛 | 4 |
| 精华消息 | 3 |
| 日程 | 5 |
| 表情表态 | 3 |
| 互动 | 1 |
| 自定义菜单 | 2 |
| 指令面板 | 6 |
| 素材管理 | 4 |

## API 明细

### 机器人（3）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `get_bot_info` | GET | `/users/@me` | ✅ | — |
| `list_bot_guilds` | GET | `/users/@me/guilds` | ✅ | — |
| `generate_share_link` | POST | `/v2/generate_url_link` | ✅ | — |

### 网关（2）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `get_gateway` | GET | `/gateway` | ✅ | — |
| `get_gateway_bot` | GET | `/gateway/bot` | ✅ | — |

### 单聊消息（6）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `send_c2c_message` | POST | `/v2/users/{user_openid}/messages` | — | — |
| `stream_c2c_message` | POST | `/v2/users/{user_openid}/stream_messages` | — | — |
| `recall_c2c_message` | DELETE | `/v2/users/{user_openid}/messages/{message_id}` | — | — |
| `upload_c2c_file` | POST | `/v2/users/{user_openid}/files` | — | — |
| `prepare_c2c_upload` | POST | `/v2/users/{user_id}/upload_prepare` | — | — |
| `finish_c2c_upload_part` | POST | `/v2/users/{user_id}/upload_part_finish` | — | — |

### 群聊消息（5）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `send_group_message` | POST | `/v2/groups/{group_openid}/messages` | — | — |
| `recall_group_message` | DELETE | `/v2/groups/{group_openid}/messages/{message_id}` | — | — |
| `upload_group_file` | POST | `/v2/groups/{group_openid}/files` | — | — |
| `prepare_group_upload` | POST | `/v2/groups/{group_id}/upload_prepare` | — | — |
| `finish_group_upload_part` | POST | `/v2/groups/{group_id}/upload_part_finish` | — | — |

### 群管理（17）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `get_group_info` | GET | `/v2/groups/{group_openid}/info` | ✅ | 需权限 |
| `get_group_bot_state` | GET | `/v2/groups/{group_openid}/bot_state` | ✅ | 需权限 |
| `list_group_members` | GET | `/v2/groups/{group_openid}/members` | ✅ | 需权限 |
| `get_group_member` | GET | `/v2/groups/{group_openid}/members/{member_openid}` | ✅ | 需权限 |
| `batch_remove_group_members` | POST | `/v2/groups/{group_openid}/batch_remove_members` | — | 需权限 |
| `list_group_join_requests` | GET | `/v2/groups/{group_openid}/join_request_list` | ✅ | — |
| `approve_group_join_request` | POST | `/v2/groups/{group_openid}/approval_join_request/{member_openid}` | — | — |
| `list_join_approval_strategies` | GET | `/v2/groups/join_approval_strategy` | ✅ | — |
| `create_join_approval_strategy` | POST | `/v2/groups/join_approval_strategy` | — | — |
| `update_join_approval_strategy` | PATCH | `/v2/groups/join_approval_strategy/{strategy_id}` | — | — |
| `delete_join_approval_strategy` | DELETE | `/v2/groups/join_approval_strategy/{strategy_id}` | — | — |
| `execute_join_approval_strategy` | POST | `/v2/groups/join_approval_strategy/{strategy_id}/execute` | — | — |
| `update_join_approval_whitelist` | POST | `/v2/groups/join_approval_strategy/{strategy_id}/whitelist_users` | — | — |
| `list_group_blacklist` | GET | `/v2/groups/{group_openid}/member_blacklist` | ✅ | 需权限 |
| `update_group_blacklist` | POST | `/v2/groups/{group_openid}/member_blacklist` | — | 需权限 |
| `get_group_mute_setting` | GET | `/v2/groups/{group_openid}/restrict_chat_setting` | ✅ | — |
| `set_group_member_mute` | POST | `/v2/groups/{group_openid}/restrict_chat_setting` | — | — |

### 频道消息（7）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `send_channel_message` | POST | `/channels/{channel_id}/messages` | — | — |
| `recall_channel_message` | DELETE | `/channels/{channel_id}/messages/{message_id}` | — | — |
| `create_dm_session` | POST | `/users/@me/dms` | — | — |
| `send_dm_message` | POST | `/dms/{guild_id}/messages` | — | — |
| `recall_dm_message` | DELETE | `/dms/{guild_id}/messages/{message_id}` | — | — |
| `get_channel_message` | GET | `/channels/{channel_id}/messages/{message_id}` | ✅ | legacy |
| `patch_channel_message` | PATCH | `/channels/{channel_id}/messages/{message_id}` | — | legacy |

### 频道管理（13）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `get_guild` | GET | `/guilds/{guild_id}` | ✅ | — |
| `list_guild_channels` | GET | `/guilds/{guild_id}/channels` | ✅ | — |
| `create_guild_channel` | POST | `/guilds/{guild_id}/channels` | — | — |
| `get_channel` | GET | `/channels/{channel_id}` | ✅ | — |
| `update_channel` | PATCH | `/channels/{channel_id}` | — | — |
| `delete_channel` | DELETE | `/channels/{channel_id}` | — | — |
| `list_guild_members` | GET | `/guilds/{guild_id}/members` | ✅ | — |
| `get_guild_member` | GET | `/guilds/{guild_id}/members/{user_id}` | ✅ | — |
| `remove_guild_member` | DELETE | `/guilds/{guild_id}/members/{user_id}` | — | — |
| `list_role_members` | GET | `/guilds/{guild_id}/roles/{role_id}/members` | ✅ | — |
| `get_channel_online_nums` | GET | `/channels/{channel_id}/online_nums` | ✅ | — |
| `list_voice_members` | GET | `/channels/{channel_id}/voice/members` | ✅ | legacy |
| `get_guild_message_setting` | GET | `/guilds/{guild_id}/message/setting` | ✅ | — |

### 身份组（6）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `list_guild_roles` | GET | `/guilds/{guild_id}/roles` | ✅ | — |
| `create_guild_role` | POST | `/guilds/{guild_id}/roles` | — | — |
| `update_guild_role` | PATCH | `/guilds/{guild_id}/roles/{role_id}` | — | — |
| `delete_guild_role` | DELETE | `/guilds/{guild_id}/roles/{role_id}` | — | — |
| `add_guild_member_role` | PUT | `/guilds/{guild_id}/members/{user_id}/roles/{role_id}` | — | — |
| `remove_guild_member_role` | DELETE | `/guilds/{guild_id}/members/{user_id}/roles/{role_id}` | — | — |

### 子频道权限（4）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `get_channel_user_permissions` | GET | `/channels/{channel_id}/members/{user_id}/permissions` | ✅ | — |
| `update_channel_user_permissions` | PUT | `/channels/{channel_id}/members/{user_id}/permissions` | — | — |
| `get_channel_role_permissions` | GET | `/channels/{channel_id}/roles/{role_id}/permissions` | ✅ | — |
| `update_channel_role_permissions` | PUT | `/channels/{channel_id}/roles/{role_id}/permissions` | — | — |

### 接口权限（2）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `get_guild_api_permissions` | GET | `/guilds/{guild_id}/api_permission` | ✅ | — |
| `request_guild_api_permission` | POST | `/guilds/{guild_id}/api_permission/demand` | — | — |

### 禁言（3）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `mute_guild` | PATCH | `/guilds/{guild_id}/mute` | — | — |
| `mute_guild_member` | PATCH | `/guilds/{guild_id}/members/{user_id}/mute` | — | — |
| `mute_guild_members` | PATCH | `/guilds/{guild_id}/mute` | — | — |

### 公告（4）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `create_guild_announce` | POST | `/guilds/{guild_id}/announces` | — | — |
| `delete_guild_announce` | DELETE | `/guilds/{guild_id}/announces/{message_id}` | — | — |
| `create_channel_announce` | POST | `/channels/{channel_id}/announces` | — | deprecated |
| `delete_channel_announce` | DELETE | `/channels/{channel_id}/announces/{message_id}` | — | deprecated |

### 音频（3）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `control_channel_audio` | POST | `/channels/{channel_id}/audio` | — | — |
| `join_channel_mic` | PUT | `/channels/{channel_id}/mic` | — | — |
| `leave_channel_mic` | DELETE | `/channels/{channel_id}/mic` | — | — |

### 论坛（4）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `list_forum_threads` | GET | `/channels/{channel_id}/threads` | ✅ | — |
| `get_forum_thread` | GET | `/channels/{channel_id}/threads/{thread_id}` | ✅ | — |
| `create_forum_thread` | PUT | `/channels/{channel_id}/threads` | — | — |
| `delete_forum_thread` | DELETE | `/channels/{channel_id}/threads/{thread_id}` | — | — |

### 精华消息（3）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `list_pins` | GET | `/channels/{channel_id}/pins` | ✅ | — |
| `add_pin` | PUT | `/channels/{channel_id}/pins/{message_id}` | — | — |
| `delete_pin` | DELETE | `/channels/{channel_id}/pins/{message_id}` | — | — |

### 日程（5）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `list_schedules` | GET | `/channels/{channel_id}/schedules` | ✅ | — |
| `get_schedule` | GET | `/channels/{channel_id}/schedules/{schedule_id}` | ✅ | — |
| `create_schedule` | POST | `/channels/{channel_id}/schedules` | — | — |
| `update_schedule` | PATCH | `/channels/{channel_id}/schedules/{schedule_id}` | — | — |
| `delete_schedule` | DELETE | `/channels/{channel_id}/schedules/{schedule_id}` | — | — |

### 表情表态（3）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `add_reaction` | PUT | `/channels/{channel_id}/messages/{message_id}/reactions/{type}/{id}` | — | — |
| `delete_reaction` | DELETE | `/channels/{channel_id}/messages/{message_id}/reactions/{type}/{id}` | — | — |
| `list_reaction_users` | GET | `/channels/{channel_id}/messages/{message_id}/reactions/{type}/{id}` | ✅ | — |

### 互动（1）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `respond_interaction` | PUT | `/interactions/{interaction_id}` | — | — |

### 自定义菜单（2）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `get_menu` | GET | `/v2/menu` | ✅ | — |
| `set_menu` | PUT | `/v2/menu` | — | — |

### 指令面板（6）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `list_panels` | GET | `/v2/panels` | ✅ | — |
| `create_panel` | POST | `/v2/panels` | — | — |
| `get_panel` | GET | `/v2/panels/{panel_id}` | ✅ | — |
| `update_panel` | PUT | `/v2/panels/{panel_id}` | — | — |
| `delete_panel` | DELETE | `/v2/panels/{panel_id}` | — | — |
| `update_panel_targets` | PUT | `/v2/panels/{panel_id}/target` | — | — |

### 素材管理（4）

| API | 方法 | 路径 | 读 | 备注 |
| --- | --- | --- | --- | --- |
| `prepare_media_image` | POST | `/v2/media-images/prepare` | — | — |
| `complete_media_image` | POST | `/v2/media-images/complete` | — | — |
| `list_media_images` | GET | `/v2/media-images` | ✅ | — |
| `delete_media_image` | DELETE | `/v2/media-images/{image_id}/delete` | — | — |

## 事件分类

| 分类 | 数量 |
| --- | --- |
| 单聊消息 | 3 |
| 好友 | 2 |
| 群聊消息 | 2 |
| 群管理 | 7 |
| 互动 | 1 |
| 订阅消息 | 1 |
| 频道 | 6 |
| 频道消息 | 6 |
| 表情表态 | 2 |
| 频道成员 | 3 |
| 消息审核 | 2 |
| 论坛 | 15 |
| 音频 | 2 |
| 系统 | 1 |

## 事件明细

### 单聊消息（3）

| 事件 | intents | 说明 |
| --- | --- | --- |
| `C2C_MESSAGE_CREATE` | GROUP_AND_C2C_EVENT | 用户单聊发消息给机器人 |
| `C2C_MSG_RECEIVE` | GROUP_AND_C2C_EVENT | 用户在机器人资料卡开启主动消息推送 |
| `C2C_MSG_REJECT` | GROUP_AND_C2C_EVENT | 用户在机器人资料卡关闭主动消息推送 |

### 好友（2）

| 事件 | intents | 说明 |
| --- | --- | --- |
| `FRIEND_ADD` | GROUP_AND_C2C_EVENT | 用户添加机器人为好友 |
| `FRIEND_DEL` | GROUP_AND_C2C_EVENT | 用户删除机器人好友 |

### 群聊消息（2）

| 事件 | intents | 说明 |
| --- | --- | --- |
| `GROUP_AT_MESSAGE_CREATE` | GROUP_AND_C2C_EVENT | 用户在群里 @机器人 时收到消息 |
| `GROUP_MESSAGE_CREATE` | GROUP_AND_C2C_EVENT | 群消息全量模式（不要求 @机器人） |

### 群管理（7）

| 事件 | intents | 说明 |
| --- | --- | --- |
| `GROUP_ADD_ROBOT` | GROUP_AND_C2C_EVENT | 机器人被添加到群聊 |
| `GROUP_DEL_ROBOT` | GROUP_AND_C2C_EVENT | 机器人被移出群聊 |
| `GROUP_MSG_RECEIVE` | GROUP_AND_C2C_EVENT | 群管理员开启机器人消息通知 |
| `GROUP_MSG_REJECT` | GROUP_AND_C2C_EVENT | 群管理员关闭机器人消息通知 |
| `GROUP_JOIN_REQUEST` | GROUP_AND_C2C_EVENT | 用户申请加群 |
| `GROUP_MEMBER_ADD` | GROUP_AND_C2C_EVENT | 群成员加入 |
| `GROUP_MEMBER_REMOVE` | GROUP_AND_C2C_EVENT | 群成员退出 |

### 互动（1）

| 事件 | intents | 说明 |
| --- | --- | --- |
| `INTERACTION_CREATE` | INTERACTION | 互动事件（消息按钮/快捷菜单/清空会话等） |

### 订阅消息（1）

| 事件 | intents | 说明 |
| --- | --- | --- |
| `SUBSCRIBE_MESSAGE_STATUS` | GROUP_AND_C2C_EVENT | 用户对订阅消息模板的授权状态变更 |

### 频道（6）

| 事件 | intents | 说明 |
| --- | --- | --- |
| `GUILD_CREATE` | GUILDS | 机器人加入新频道（guild） |
| `GUILD_UPDATE` | GUILDS | 频道资料发生变更 |
| `GUILD_DELETE` | GUILDS | 机器人退出/频道解散 |
| `CHANNEL_CREATE` | GUILDS | 子频道被创建 |
| `CHANNEL_UPDATE` | GUILDS | 子频道被更新 |
| `CHANNEL_DELETE` | GUILDS | 子频道被删除 |

### 频道消息（6）

| 事件 | intents | 说明 |
| --- | --- | --- |
| `AT_MESSAGE_CREATE` | PUBLIC_GUILD_MESSAGES | 频道内 @机器人 的消息（公域） |
| `MESSAGE_CREATE` | GUILD_MESSAGES | 频道内全部消息（仅私域机器人） |
| `MESSAGE_DELETE` | GUILD_MESSAGES | 频道消息被删除（仅私域机器人） |
| `PUBLIC_MESSAGE_DELETE` | PUBLIC_GUILD_MESSAGES | 公域频道消息被删除 |
| `DIRECT_MESSAGE_CREATE` | DIRECT_MESSAGE | 收到用户发给机器人的频道私信 |
| `DIRECT_MESSAGE_DELETE` | DIRECT_MESSAGE | 频道私信被删除 |

### 表情表态（2）

| 事件 | intents | 说明 |
| --- | --- | --- |
| `MESSAGE_REACTION_ADD` | GUILD_MESSAGE_REACTIONS | 为频道消息添加表情表态 |
| `MESSAGE_REACTION_REMOVE` | GUILD_MESSAGE_REACTIONS | 为频道消息删除表情表态 |

### 频道成员（3）

| 事件 | intents | 说明 |
| --- | --- | --- |
| `GUILD_MEMBER_ADD` | GUILD_MEMBERS | 频道成员加入 |
| `GUILD_MEMBER_UPDATE` | GUILD_MEMBERS | 频道成员资料变更 |
| `GUILD_MEMBER_REMOVE` | GUILD_MEMBERS | 频道成员被移除 |

### 消息审核（2）

| 事件 | intents | 说明 |
| --- | --- | --- |
| `MESSAGE_AUDIT_PASS` | MESSAGE_AUDIT | 频道消息审核通过 |
| `MESSAGE_AUDIT_REJECT` | MESSAGE_AUDIT | 频道消息审核不通过 |

### 论坛（15）

| 事件 | intents | 说明 |
| --- | --- | --- |
| `FORUM_THREAD_CREATE` | FORUMS_EVENT | 用户创建论坛主题 |
| `FORUM_THREAD_UPDATE` | FORUMS_EVENT | 用户更新论坛主题 |
| `FORUM_THREAD_DELETE` | FORUMS_EVENT | 用户删除论坛主题 |
| `FORUM_POST_CREATE` | FORUMS_EVENT | 用户创建论坛帖子 |
| `FORUM_POST_DELETE` | FORUMS_EVENT | 用户删除论坛帖子 |
| `FORUM_REPLY_CREATE` | FORUMS_EVENT | 用户回复论坛评论 |
| `FORUM_REPLY_DELETE` | FORUMS_EVENT | 用户删除论坛评论 |
| `FORUM_PUBLISH_AUDIT_RESULT` | FORUMS_EVENT | 论坛内容发表审核结果 |
| `OPEN_FORUM_THREAD_CREATE` | FORUMS_EVENT | 开放论坛主题创建 |
| `OPEN_FORUM_THREAD_UPDATE` | FORUMS_EVENT | 开放论坛主题更新 |
| `OPEN_FORUM_THREAD_DELETE` | FORUMS_EVENT | 开放论坛主题删除 |
| `OPEN_FORUM_POST_CREATE` | FORUMS_EVENT | 开放论坛帖子创建 |
| `OPEN_FORUM_POST_DELETE` | FORUMS_EVENT | 开放论坛帖子删除 |
| `OPEN_FORUM_REPLY_CREATE` | FORUMS_EVENT | 开放论坛评论创建 |
| `OPEN_FORUM_REPLY_DELETE` | FORUMS_EVENT | 开放论坛评论删除 |

### 音频（2）

| 事件 | intents | 说明 |
| --- | --- | --- |
| `AUDIO_OR_LIVE_CHANNEL_MEMBER_ENTER` | AUDIO_ACTION | 成员进入音视频/直播子频道 |
| `AUDIO_OR_LIVE_CHANNEL_MEMBER_EXIT` | AUDIO_ACTION | 成员离开音视频/直播子频道 |

### 系统（1）

| 事件 | intents | 说明 |
| --- | --- | --- |
| `READY` | — | 网关鉴权成功，返回 session_id 与机器人信息 |

## 覆盖口径

- **API 条目**以“一个 method + path 模板”为单位；同一页面的多个接口（私信、表情表态、素材管理）分别建条目。
- **事件条目**包含 v2 群/单聊事件、频道事件、论坛/音频事件以及 `READY`。`READY` 是网关生命周期事件，没有独立 intent。
- **readOnly** 依据 HTTP 语义与人工确认：GET 为只读；少数 POST 但只生成链接/分享串的接口（如 `generate_share_link`）也标为只读。
- **legacy** 表示仍可用但当前 wiki 索引未列出的接口，主要来自 botpy 参考实现：`get_channel_message`、`patch_channel_message`、`list_voice_members`。
- **deprecated** 表示 wiki 明确标注旧版/将被替换：`create_channel_announce`、`delete_channel_announce`。
- **permissionRequired** 主要来自群管理文档的“需要权限”提示；实际权限还取决于机器人类型、认证状态和平台白名单。

## 已知缺口与注意事项

1. **未做真实机器人线上验收**：所有测试均使用 mock 和官方固定签名向量。上线前请用沙箱机器人验证 token、网关、发消息、上传和 webhook。
2. **白名单能力**：音频控制、论坛、公告、接口权限、主动消息、Markdown/按钮等可能需要企业认证或单独申请；目录里有标记，但平台策略会变。
3. **频道发送依赖网关在线**：`send_channel_message` 在机器人未连接 WebSocket 时返回 304018；只开 webhook 不够。
4. **富媒体 `file_data`**：官方文档未明确 base64 编码细节，本项目统一使用分片上传；`file_data` 字段仍保留在 schema 中供手工调用。
5. **旧接口**：`patch_channel_message` 来自 botpy，当前 wiki 可能已不再提供；调用失败时以官方文档为准。
6. **多 shard**：单进程只跑一个 shard，需要多进程 + `QQBOT_MCP_SHARD`。

## 重新校验

```bash
npm run check:coverage
```

该命令会：

- 拉取 <https://bot.q.qq.com/wiki/sitemap.xml>；
- 检查 47 个 autogen API 页面是否都有条目；
- 检查 22 个 autogen 事件页面是否都有条目；
- 解析 91 个 server-inter 页面，检查 48 个含接口的页面是否被覆盖（重复文档按 method+path 去重）；
- 校验每个 server-inter 条目的 method/path 与文档一致；
- 输出 warnings；有缺失时退出码 1。

上游新增接口时，先运行 `npm run bootstrap` 生成草稿，人工改名/分类后再合并到 `catalog/sources.json`，最后 `npm run gen`。
