# 安装与运行

## 前置条件

- Linux / macOS，Node.js **>= 22**。
- 能访问 `<https://api.bot.qq.com>`。
- 一个 QQ 官方机器人 AppID + AppSecret（步骤见 [CREDENTIALS.md](CREDENTIALS.md)）。

## npm 安装

```bash
npm install -g qqbot-mcp
qqbot-mcp --version
```

临时运行：

```bash
npx -y qqbot-mcp
```

## 源码 / 本机安装

```bash
git clone https://github.com/Pheobe-Southwood/qqbot-mcp.git
cd qqbot-mcp
pnpm install
npm test
npm run build
sudo ./deploy/install.sh
```

`deploy/install.sh` 会：

1. 检查 Node 版本、`dist/cli.js`、`dist/server.js`；
2. 把 `dist/`、`catalog/`、`docs/`、`examples/`、`package.json`、`README.md`、`LICENSE` 复制到 `/opt/qqbot-mcp`；
3. 创建 `/usr/local/bin/qqbot-mcp` wrapper；
4. 如果 `/etc/qqbot-mcp.env` 不存在，从模板创建并 `chmod 600`；
5. 不注册 DSH、不启动守护进程。

安装结果：

```text
/opt/qqbot-mcp                 程序目录
/usr/local/bin/qqbot-mcp       CLI（自动加载 /etc/qqbot-mcp.env）
/etc/qqbot-mcp.env             配置，权限 600
```

## 配置

```bash
sudo chmod 600 /etc/qqbot-mcp.env
sudo editor /etc/qqbot-mcp.env
```

最少：

```bash
QQBOT_APP_ID=102xxxxxx
QQBOT_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
QQBOT_MCP_MODE=read
```

建议：

```bash
QQBOT_MCP_UPLOAD_ROOT=/srv/qqbot-files
QQBOT_MCP_DOWNLOAD_DIR=/var/lib/qqbot-mcp/downloads
QQBOT_MCP_EVENT_TRANSPORT=websocket
QQBOT_MCP_EVENT_AUTOSTART=true
QQBOT_MCP_INTENTS=GROUP_AND_C2C_EVENT,INTERACTION,PUBLIC_GUILD_MESSAGES
```

准备目录：

```bash
sudo install -d -m 700 -o "$USER" -g "$USER" /srv/qqbot-files
sudo install -d -m 700 -o "$USER" -g "$USER" /var/lib/qqbot-mcp/downloads
```

- `QQBOT_MCP_UPLOAD_ROOT` 是上传文件的唯一允许目录；不设置则禁用 `file_path`。
- AppSecret 只放在 600 权限的 env 文件里，不要写进仓库或客户端 JSON。
- 完整变量表见 [CONFIGURATION.md](CONFIGURATION.md)。

## 使用

### 交互式 CLI

```bash
qqbot-mcp
```

启动后显示二维码、链接、PNG 路径，然后进入 `qqbot>`。命令见 [CLI.md](CLI.md)。

### MCP 客户端

```json
{
  "mcpServers": {
    "qqbot": {
      "command": "/usr/local/bin/qqbot-mcp",
      "args": ["--mcp"]
    }
  }
}
```

`/usr/local/bin/qqbot-mcp` 会自动读 `/etc/qqbot-mcp.env`，所以不需要把 secret 写进 JSON。如果要跳过 env 文件：

```json
{
  "mcpServers": {
    "qqbot": {
      "command": "/usr/local/bin/qqbot-mcp",
      "args": ["--mcp"],
      "env": {
        "QQBOT_MCP_SKIP_ENV_FILE": "1",
        "QQBOT_APP_ID": "102xxxxxx",
        "QQBOT_APP_SECRET": "xxxxxxxx",
        "QQBOT_MCP_MODE": "read"
      }
    }
  }
}
```

npx 方式：

```json
{
  "mcpServers": {
    "qqbot": {
      "command": "npx",
      "args": ["-y", "qqbot-mcp", "--mcp"],
      "env": {
        "QQBOT_APP_ID": "102xxxxxx",
        "QQBOT_APP_SECRET": "xxxxxxxx",
        "QQBOT_MCP_MODE": "read"
      }
    }
  }
}
```

## 验收

```bash
qqbot-mcp --version
qqbot-mcp --qr
qqbot-mcp --mcp
```

MCP 握手：

```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}' \
| qqbot-mcp --mcp
```

预期 stdout 只有 JSON-RPC，stderr 有 `QQbot-MCP ready`，且不包含 token/secret。

真实凭据下建议依次测试：

1. `bot_status(probe_network=true)`；
2. `get_gateway_bot`；
3. `send_message` 给测试群发文本；
4. `start_event_stream` + `wait_events` 收一条群 @ 消息；
5. `upload_media` 上传一个小文件；
6. Webhook 模式用公网回调验证 `op=13`。

## 升级

```bash
npm install -g qqbot-mcp@latest
```

源码安装：

```bash
git pull
pnpm install
npm run build
sudo ./deploy/install.sh
```

`install.sh` 不会覆盖已存在的 `/etc/qqbot-mcp.env`。

## 卸载

```bash
npm uninstall -g qqbot-mcp
```

源码安装额外清理：

```bash
sudo rm -f /usr/local/bin/qqbot-mcp
sudo rm -rf /opt/qqbot-mcp
# 确认不再需要后再删：
# sudo rm -f /etc/qqbot-mcp.env
# sudo rm -rf /var/lib/qqbot-mcp /srv/qqbot-files
```

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 启动即退出 | 检查 Node >=22；用 `qqbot-mcp --mcp` 看 stderr |
| `mode=docs` 即使配置了 read | AppID/Secret 不完整；看启动警告 |
| `100016` | AppID/AppSecret 错误，或 IP 不在白名单 |
| `304018` | 频道消息需要 WebSocket 网关在线；`events start websocket` |
| 事件收不到 | 检查 intents、机器人是否在群/频道、网关 state 是否 ready |
| Webhook 401 | 反代改了 body 或丢了 `X-Signature-*`；确认原样转发 |
| 上传被拒绝 | 文件不在 `QQBOT_MCP_UPLOAD_ROOT` 内，或超过 200MB |
| `EADDRINUSE` | 改 `QQBOT_MCP_WEBHOOK_PORT`，或停掉占用端口的进程 |
| 二维码图片找不到 | 看 CLI 打印的绝对路径；或设置 `QQBOT_MCP_QR_DIR` |
