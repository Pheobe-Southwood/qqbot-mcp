# 示例提示词

把下面这些直接发给支持 MCP 的 Agent，它会按需调用 QQbot-MCP。

## 查能力

- 列出所有群聊消息相关的 API，标出哪些是写操作。
- 搜索“撤回”，告诉我单聊、群聊、频道分别用哪个接口。
- 给我看 `send_group_message` 的完整参数、返回字段和错误码。
- 列出 `GROUP_AND_C2C_EVENT` intent 下的所有事件。
- 看下 `bot_status`，如果配置了凭据就顺便探测一下网关。

## 发消息

- 给群 `GROUP_OPENID` 发一条文本：“构建完成”。
- 给群 `GROUP_OPENID` 发一条 Markdown，内容是构建结果表格。
- 把 `/srv/qqbot-files/report.pdf` 发到群 `GROUP_OPENID`，并附一句“今天的报告”。
- 给用户 `USER_OPENID` 发一条单聊消息，用 Markdown。
- 回复群里刚才 @我 的那条消息，`msg_id` 是 `EVENT_D_ID`。
- 给频道 `CHANNEL_ID` 发一张本地图片 `/srv/qqbot-files/chart.png`。

## 群/频道管理

- 查一下群 `GROUP_OPENID` 的成员列表，前 20 个。
- 把这个群的入群申请列表拉出来，告诉我哪些在待审批。
- 把用户 `MEMBER_OPENID` 移出群 `GROUP_OPENID`，并加入黑名单。
- 给频道 `GUILD_ID` 建一个名为 `build-logs` 的文字子频道。
- 列出频道 `GUILD_ID` 的身份组，并给用户 `USER_ID` 加上 `ROLE_ID`。
- 把子频道 `CHANNEL_ID` 的 `view_channel` 权限授予身份组 `ROLE_ID`。

## 事件

- 启动 WebSocket 事件流，只收群 @ 消息和单聊消息。
- 等一条 `GROUP_AT_MESSAGE_CREATE`，拿到后把内容、发送者、群 openid 整理成 JSON。
- 看看事件缓冲里有什么，类型统计和最近 10 条。
- 停止事件流，但保留缓冲。

## 附件

- 下载这条消息里的附件到本地，告诉我路径和 sha256。
- 把这个图片 URL 下载下来，文件名用 `chart.png`。

## 多步任务

- 监听群 @ 消息；如果内容包含“部署”，回复“收到”，然后查一下最近 5 条频道消息。
- 依次检查网关状态、token 状态、事件缓冲，输出一份健康报告。
- 先查 `upload_group_file` 的参数，再把 `demo.zip` 上传到群，拿到 `file_info` 后发一条媒体消息。

> 真实调用前请把示例 ID 替换成事件或 API 返回的真实 openid / channel_id / guild_id。被动回复务必在窗口内（单聊 60 分钟/4 次，群聊 5 分钟/5 次）。
