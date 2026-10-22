# 发布

## 版本

当前包名 `qqbot-mcp`，npm 账号 `phoebe-southwood`，版本在 `package.json` 中维护。

发布前先确认：

```bash
npm whoami
npm view qqbot-mcp version 2>/dev/null || true
```

如果版本已存在，先升版本（本项目使用 `0.2.x` 语义）：

```bash
npm version patch --no-git-tag-version
```

## 检查

```bash
npm run typecheck
npm test
npm run build
npm run smoke
npm run check:coverage
npm pack --dry-run
```

`npm pack --dry-run` 应只包含：

- `dist/`
- `docs/`
- `catalog/`
- `examples/`
- `deploy/`
- `README.md`、`LICENSE`、`.env.example`、`package.json`
- `dist/generated/*.json`

不能包含 `.env`、真实 token、`.cache/`、`node_modules/`、`.git/`。

## 发布到 npm

```bash
npm publish --access public
```

- 账号已登录为 `phoebe-southwood`。
- 如果 npm 要求 2FA/OTP，会提示输入一次性验证码；不要把 OTP 写入文件。
- `prepublishOnly` 会再跑 typecheck、测试、build。
- 发布后验证：

```bash
npm view qqbot-mcp version description
```

发布后的临时验证：

```bash
cd /tmp
npx -y qqbot-mcp --help
npx -y qqbot-mcp --qr
```

## GitHub

仓库：`Pheobe-Southwood/qqbot-mcp`（公开）。

首次发布/推送：

```bash
git init -b main
git add .
git commit -m "feat: add interactive CLI, QR onboarding and Chinese docs"
gh repo create Pheobe-Southwood/qqbot-mcp --public --source=. --remote=origin --push
```

设置 About：

```bash
gh repo edit Pheobe-Southwood/qqbot-mcp \
  --description "QQ 官方机器人 OpenAPI 的 MCP 服务与中文交互式 CLI：发消息、管理群/频道、上传富媒体、接收网关事件。" \
  --homepage "https://www.npmjs.com/package/qqbot-mcp" \
  --add-topic qqbot --add-topic qq-robot --add-topic mcp --add-topic cli \
  --add-topic typescript --add-topic model-context-protocol
```

## 发布顺序

1. 代码、README、docs 完成；
2. 完整验收；
3. git 提交；
4. 创建/推送 GitHub 仓库；
5. 设置 GitHub About；
6. `npm pack --dry-run`；
7. `npm publish`；
8. `npm view` / `npx` 验证。
