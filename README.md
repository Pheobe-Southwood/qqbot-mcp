# QQbot-MCP

把 QQ 官方机器人 OpenAPI 封装成 **MCP 服务**和**中文交互式 CLI**。不记接口路径，也能在终端或 Agent 里发消息、管理群/频道、上传文件、接收事件。

> 社区实现，不是腾讯官方产品。QQ API 可能调整，升级前请关注 [覆盖清单](https://github.com/Pheobe-Southwood/qqbot-mcp/blob/main/docs/COVERAGE.md)。

## 关于

- 覆盖 **103 个 API**、**21 个分类**、**53 个事件**：单聊、群聊、频道、身份组、禁言、公告、论坛、音频、日程、表情表态、互动、菜单、指令面板、素材等。
- 两种用法：终端里的 `qqbot-mcp`，或 MCP 客户端里的 `qqbot-mcp --mcp`。
- 三档模式：`docs` 只查文档，`read` 查接口，`write` 发消息/管理；无凭据自动停在 `docs`。
- 事件按需开启：WebSocket 网关或 Webhook（Ed25519 验签）。
- 富媒体：本地文件分片上传、频道图片 multipart、Markdown 图片、附件下载。
- CLI 启动即显示二维码、机器人创建/登录链接和二维码 PNG 路径。

## 安装

要求 **Node.js >= 22**。

### npm 全局安装

```bash
npm install -g qqbot-mcp
qqbot-mcp --version
```

### 直接运行

```bash
npx -y qqbot-mcp
```

### 源码安装

```bash
git clone https://github.com/Pheobe-Southwood/qqbot-mcp.git
cd qqbot-mcp
pnpm install
npm run build
sudo ./deploy/install.sh
```

完整安装说明见 [docs/INSTALL.md](https://github.com/Pheobe-Southwood/qqbot-mcp/blob/main/docs/INSTALL.md)。

## 配置

最少填 AppID 和 AppSecret：

```bash
QQBOT_APP_ID=102xxxxxx
QQBOT_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
QQBOT_MCP_MODE=read
```

- AppID/AppSecret 在 [QQ 开放平台](https://q.qq.com/) 的机器人「开发设置」中获取，步骤见 [docs/CREDENTIALS.md](https://github.com/Pheobe-Southwood/qqbot-mcp/blob/main/docs/CREDENTIALS.md)。
- 本机安装后编辑 `/etc/qqbot-mcp.env`（权限 `600`）。
- MCP 客户端可把变量写进 `env`。
- 完整变量表见 [docs/CONFIGURATION.md](https://github.com/Pheobe-Southwood/qqbot-mcp/blob/main/docs/CONFIGURATION.md)。

## 使用

### 交互式 CLI

```bash
qqbot-mcp
```

启动后会显示二维码、链接、PNG 路径，然后进入 `qqbot>`：

```text
扫码创建/连接 QQ 机器人：
https://q.qq.com/qqbot/openclaw/login.html?redirect_url=...

二维码图片：/tmp/qqbot-mcp-qr-xxxx/qqbot-mcp-qr-xxxx.png

qqbot> send group GROUP_OPENID 大家好
qqbot> events start websocket
qqbot> exit
```

常用命令：

| 命令 | 作用 |
| --- | --- |
| `help` | 查看全部命令 |
| `status` | 运行状态 |
| `qr` | 重新生成二维码 |
| `apis [关键词]` / `api <名称>` | 查 API |
| `send` | 向导式发消息 |
| `reply` | 向导式被动回复 |
| `events status/start/stop/poll/wait` | 事件流 |
| `mcp` | 打印 MCP 客户端配置 |
| `exit` / `quit` | 退出 |

完整命令和示例见 [docs/CLI.md](https://github.com/Pheobe-Southwood/qqbot-mcp/blob/main/docs/CLI.md)。

### 在 MCP 客户端中使用

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

本机安装也可以写：

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

无参数但 stdin/stdout 不是终端时，也会自动按 MCP 运行，兼容旧配置。

### 二维码

- 默认内容：QQ 机器人快速创建/登录入口。
- `qqbot-mcp --qr`：只打印二维码/链接/图片路径后退出。
- `--no-qr` 或 `QQBOT_MCP_QR=off`：启动时跳过。
- `QQBOT_MCP_QR_URL`：换成自定义邀请链接。
- 二维码不会包含 AppSecret，也不会自动绑定机器人。

## 文档

- [CLI 命令](https://github.com/Pheobe-Southwood/qqbot-mcp/blob/main/docs/CLI.md)
- [配置](https://github.com/Pheobe-Southwood/qqbot-mcp/blob/main/docs/CONFIGURATION.md)
- [获取 AppID/AppSecret](https://github.com/Pheobe-Southwood/qqbot-mcp/blob/main/docs/CREDENTIALS.md)
- [工具参考](https://github.com/Pheobe-Southwood/qqbot-mcp/blob/main/docs/TOOLS.md)
- [覆盖清单](https://github.com/Pheobe-Southwood/qqbot-mcp/blob/main/docs/COVERAGE.md)
- [架构](https://github.com/Pheobe-Southwood/qqbot-mcp/blob/main/docs/ARCHITECTURE.md)
- [安装](https://github.com/Pheobe-Southwood/qqbot-mcp/blob/main/docs/INSTALL.md)
- [开发与验收](https://github.com/Pheobe-Southwood/qqbot-mcp/blob/main/docs/DEVELOPMENT.md)
- [发布](https://github.com/Pheobe-Southwood/qqbot-mcp/blob/main/docs/PUBLISHING.md)
- [上游同步](https://github.com/Pheobe-Southwood/qqbot-mcp/blob/main/docs/UPSTREAM-SYNC.md)

## 许可证

MIT，见 [LICENSE](https://github.com/Pheobe-Southwood/qqbot-mcp/blob/main/LICENSE)。
