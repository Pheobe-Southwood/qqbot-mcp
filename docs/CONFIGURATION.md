# 配置

## 三档模式

| 模式 | 工具数 | 能做什么 | 凭据 |
| --- | --- | --- | --- |
| `docs` | 7 | 查目录、搜 API、看参数/事件，不访问 QQ | 不需要 |
| `read` | 13 | `docs` + 查询 API、轮询/等待事件、下载附件、看运行状态 | 需要 |
| `write` | 20 | `read` + 发消息、回复、上传、撤回、启停事件流 | 需要 |

规则：

- 没有凭据时强制 `docs`；即使写了 `read`/`write` 也会降级并打印警告。
- 有凭据且未设置 `QQBOT_MCP_MODE` 时默认 `read`，不会因为配置了 secret 就自动获得写权限。
- 每次 `tools/call` 都会重新检查模式；客户端缓存了工具列表也不能绕过。
- 未知 API 名称直接拒绝，并给出相近名称建议。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `QQBOT_APP_ID` | — | 机器人 AppID |
| `QQBOT_APP_SECRET` | — | 机器人 AppSecret |
| `QQBOT_ACCESS_TOKEN` | — | 直接注入 token；优先级高于 AppID/Secret |
| `QQBOT_API_BASE` | `https://api.bot.qq.com` | OpenAPI 基址，调试代理用 |
| `QQBOT_TOKEN_URL` | `${API_BASE}/app/getAppAccessToken` | token 地址 |
| `QQBOT_MCP_MODE` | 有凭据 `read`，无凭据 `docs` | `docs`/`read`/`write` |
| `QQBOT_MCP_TIMEOUT_MS` | `30000` | 单次 HTTP 超时，最大 300000 |
| `QQBOT_MCP_RATE_LIMIT` | `true` | 本地滑动窗口限速 |
| `QQBOT_MCP_UPLOAD_ROOT` | 未设置 | 允许上传的本地目录；不设置则禁用本地文件 |
| `QQBOT_MCP_DOWNLOAD_DIR` | `$TMPDIR/qqbot-mcp-downloads` | 附件下载目录 |
| `QQBOT_MCP_MAX_UPLOAD_BYTES` | `209715200` | 上传/下载硬上限，最大 200MB |
| `QQBOT_MCP_EVENT_TRANSPORT` | `off` | `off`/`websocket`/`webhook` |
| `QQBOT_MCP_EVENT_AUTOSTART` | `false` | 启动 MCP 时自动开启事件传输 |
| `QQBOT_MCP_INTENTS` | `auto` | 逗号分隔 intent 名、数字或 `all` |
| `QQBOT_MCP_SHARD` | `0,1` | `[shard_id, shard_count]`；单进程只跑一个分片 |
| `QQBOT_MCP_EVENT_BUFFER` | `1000` | 事件环形缓冲条数 |
| `QQBOT_MCP_EVENT_TTL_MS` | `1800000` | 事件保留时长 |
| `QQBOT_MCP_WEBHOOK_HOST` | `127.0.0.1` | Webhook 绑定地址 |
| `QQBOT_MCP_WEBHOOK_PORT` | `8787` | Webhook 端口，`0` 表示随机 |
| `QQBOT_MCP_WEBHOOK_PATH` | `/qqbot/webhook` | 回调路径 |
| `QQBOT_MCP_QR` | `on` | CLI 启动时是否打印二维码；`off` 关闭 |
| `QQBOT_MCP_QR_URL` | QQ 机器人快速创建/登录入口 | 二维码内容；必须是 http(s) |
| `QQBOT_MCP_QR_DIR` | 系统临时目录 | 二维码 PNG 保存目录 |
| `QQBOT_MCP_AUDIT_LOG` | 未设置 | JSONL 审计日志路径 |
| `QQBOT_MCP_AUDIT_CONTENT` | `false` | 是否在审计日志中记录消息正文 |
| `QQBOT_MCP_LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error`，全部写 stderr |

完整模板见 [`.env.example`](../.env.example)。

## 配置方式

### CLI

```bash
sudo cp .env.example /etc/qqbot-mcp.env
sudo chmod 600 /etc/qqbot-mcp.env
sudo editor /etc/qqbot-mcp.env
qqbot-mcp
```

`deploy/install.sh` 安装的 wrapper 会自动加载 `/etc/qqbot-mcp.env`。设置 `QQBOT_MCP_SKIP_ENV_FILE=1` 可跳过。

### MCP 客户端

把变量放进客户端的 `env`，或让 `command` 指向一个加载 env 文件的包装脚本。不要把 secret 提交到仓库。

```json
{
  "mcpServers": {
    "qqbot": {
      "command": "npx",
      "args": ["-y", "qqbot-mcp", "--mcp"],
      "env": {
        "QQBOT_APP_ID": "102xxxxxx",
        "QQBOT_APP_SECRET": "replace-me",
        "QQBOT_MCP_MODE": "read"
      }
    }
  }
}
```
