# 交互式 CLI

## 启动

```bash
qqbot-mcp
```

启动后依次显示：

1. 版本、模式、凭据状态、API/事件数量；
2. 二维码、二维码内容链接、PNG 临时图片路径；
3. `qqbot>` 提示符。

二维码默认编码 QQ 机器人快速创建/登录入口：

```text
https://q.qq.com/qqbot/openclaw/login.html?redirect_url=https%3A%2F%2Fq.qq.com%2Fqqbot%2Fopenclaw%2F
```

扫码后按页面提示创建/连接机器人，再把 AppID/AppSecret 写入配置。二维码不包含 AppSecret，也不会自动完成绑定。

## 启动参数

| 参数 | 作用 |
| --- | --- |
| 无参数 | 终端中进入 CLI；stdin/stdout 非 TTY 时自动进入 MCP |
| `--cli` | 强制进入 CLI |
| `--mcp` / `--stdio` | 以 stdio MCP Server 运行 |
| `--qr` | 只打印二维码/链接/PNG 路径后退出 |
| `--no-qr` | 启动 CLI 时跳过二维码 |
| `--help` / `-h` | 帮助 |
| `--version` / `-v` | 版本 |

## 命令

| 命令 | 别名 | 作用 |
| --- | --- | --- |
| `help` | `?`、`帮助` | 命令帮助 |
| `status` | `状态` | 模式、凭据、目录、事件状态 |
| `qr` | `二维码` | 重新生成二维码/链接/PNG |
| `apis [关键词]` | `接口` | 搜索 API |
| `api <名称>` | — | 查看 API 完整 schema |
| `send` | `发消息` | 向导式发消息 |
| `send <c2c\|group\|channel\|dm> <ID> <文本>` | — | 快速发文本 |
| `reply` | `回复` | 向导式被动回复 |
| `events status` | `事件` | 事件流状态 |
| `events start [websocket\|webhook]` | — | 启动事件流 |
| `events stop` | — | 停止事件流 |
| `events poll [数量]` | — | 取缓冲事件 |
| `events wait [秒数]` | — | 等待下一条事件 |
| `config` | `配置` | 脱敏后的运行配置 |
| `mcp` | — | 打印 MCP 客户端配置 |
| `exit` / `quit` | `q`、`退出` | 退出并停止事件流 |

## 示例

### 发文本

```text
qqbot> send group GROUP_OPENID 大家好，我是新来的机器人
```

### 向导式发文件

```text
qqbot> send
目标类型（c2c/group/channel/dm）：group
目标 ID：GROUP_OPENID
文本（可留空）：今天的报告
本地文件路径（可留空）：/srv/qqbot-files/report.pdf
msg_id（可留空）：
```

文件路径必须在 `QQBOT_MCP_UPLOAD_ROOT` 内。

### 被动回复

```text
qqbot> reply
目标类型（c2c/group/channel/dm）：group
目标 ID：GROUP_OPENID
msg_id（与 event_id 至少填一个）：事件里的 d.id
event_id（可留空）：
回复文本：收到
```

单聊被动回复窗口 60 分钟/4 次，群聊 5 分钟/5 次。同一次发送中的“媒体 + 文本”会自动递增 `msg_seq`；同一 `msg_id` 分多次回复时仍需自行传递增的 `msg_seq`。

### 事件

```text
qqbot> events start websocket
qqbot> events status
qqbot> events wait 30
qqbot> events stop
```

`events start` 需要 `write` 模式。

## 二维码图片

- 默认保存到系统临时目录下独立子目录；
- 文件名 `qqbot-mcp-qr-<时间戳>.png`；
- 权限 `0600`；
- CLI 会打印绝对路径；
- 可用 `QQBOT_MCP_QR_DIR` 指定目录，或 `QQBOT_MCP_QR=off` / `--no-qr` 关闭；
- `--qr` 可在不进入交互的情况下生成并打印。

## 退出

`exit`、`quit`、`q`、`退出` 或 `Ctrl+C`。退出时会尽力停止网关和 Webhook，缓冲区内容保留到进程结束。
