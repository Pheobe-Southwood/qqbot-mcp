# 获取 AppID / AppSecret

QQ 官方机器人凭据在 **QQ 开放平台** 申请，不是 QQ 号，也不是 OneBot 的 token。

## 步骤

1. 打开 <https://q.qq.com/>，用 QQ 登录，进入「QQ 开放平台」。
2. 选择「机器人」→「创建机器人」，填写名称、头像、简介、分类，提交创建。
3. 进入机器人管理页 →「开发设置」：
   - **AppID**：机器人唯一 ID，形如 `102xxxxxx`。
   - **AppSecret**：密钥，通常只完整展示一次；丢失只能重置。重置后旧 secret 立即失效。
4. 在同一页配置 **IP 白名单**：把运行 MCP/CLI 的机器出口 IP 加进去。换机器或公网 IP 后要同步更新，否则 OpenAPI 可能返回鉴权/权限错误。
5. 在「沙箱配置」把机器人加入测试频道或测试群；正式使用需要按平台要求提交发布/审核。
6. 按需在「功能配置 / 事件订阅」中开启：
   - 群 @ 消息、单聊消息、频道消息、互动事件等；
   - Webhook 回调地址（使用 webhook 模式时）；
   - 主动消息、富媒体、Markdown、按钮/键盘等能力（部分需要企业认证或白名单）。
7. 把凭据写入 `/etc/qqbot-mcp.env`（权限 `600`），或写进 MCP 客户端的 `env`：

```bash
QQBOT_APP_ID=102xxxxxx
QQBOT_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
QQBOT_MCP_MODE=read
```

## 快捷入口与二维码

CLI 启动时会打印二维码，默认编码：

```text
https://q.qq.com/qqbot/openclaw/login.html?redirect_url=https%3A%2F%2Fq.qq.com%2Fqqbot%2Fopenclaw%2F
```

这是 QQ 官方的机器人快速创建/登录入口。扫码后按页面提示创建或连接机器人，再把 AppID/AppSecret 填到本地配置。

- 二维码只是入口，不会自动绑定机器人，也不会包含 AppSecret。
- 可用 `QQBOT_MCP_QR_URL` 换成自定义邀请链接。
- 可用 `QQBOT_MCP_QR=off` 或 `--no-qr` 关闭启动二维码。
- `qqbot-mcp --qr` 可单独打印二维码后退出。

## Token 行为

MCP/CLI 会自动调用 `POST /app/getAppAccessToken` 换取 `access_token`，提前 60 秒刷新，并在 401 / 11241 / 11243 时刷新重试一次。也可以用 `QQBOT_ACCESS_TOKEN` 直接注入临时 token，适合调试，不推荐长期使用。

官方文档：<https://bot.q.qq.com/wiki/>。不同机器人类型（群机器人、频道机器人、音频机器人）能用的 API 不同，频道接口通常需要机器人先加入频道并授权。
