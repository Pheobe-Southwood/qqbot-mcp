export type CliAction = 'cli' | 'mcp' | 'qr' | 'help' | 'version';

export interface CliOptions {
  action: CliAction;
  noQr: boolean;
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

export function parseCliArgs(
  argv: string[],
  tty: { stdin: boolean; stdout: boolean } = { stdin: process.stdin.isTTY === true, stdout: process.stdout.isTTY === true },
): CliOptions {
  let cli = false;
  let mcp = false;
  let qr = false;
  let help = false;
  let version = false;
  let noQr = false;

  for (const arg of argv) {
    switch (arg) {
      case '--cli':
        cli = true;
        break;
      case '--mcp':
      case '--stdio':
        mcp = true;
        break;
      case '--qr':
        qr = true;
        break;
      case '--no-qr':
        noQr = true;
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      case '--version':
      case '-v':
        version = true;
        break;
      default:
        throw new CliUsageError(`未知参数：${arg}`);
    }
  }

  if (help) {
    if (mcp || qr || cli) throw new CliUsageError('--help 不能与其他启动参数同时使用');
    return { action: 'help', noQr };
  }
  if (version) {
    if (mcp || qr || cli) throw new CliUsageError('--version 不能与其他启动参数同时使用');
    return { action: 'version', noQr };
  }
  if (cli && mcp) throw new CliUsageError('--cli 与 --mcp 不能同时使用');
  if (qr && (cli || mcp)) throw new CliUsageError('--qr 不能与 --cli/--mcp 同时使用');
  if (qr && noQr) throw new CliUsageError('--qr 与 --no-qr 不能同时使用');
  if (qr) return { action: 'qr', noQr: false };
  if (mcp) return { action: 'mcp', noQr };
  if (cli) return { action: 'cli', noQr };

  // 交互式 CLI 需要真正的终端；管道/被 Agent 拉起时保持 MCP 兼容。
  return { action: tty.stdin && tty.stdout ? 'cli' : 'mcp', noQr };
}

export function helpText(): string {
  return `QQbot-MCP —— QQ 官方机器人 MCP 服务与中文交互式 CLI

用法：
  qqbot-mcp              在终端进入交互式 CLI
  qqbot-mcp --mcp        以 stdio MCP Server 运行，供 Agent/客户端连接
  qqbot-mcp --qr         只打印创建/连接机器人的二维码、链接和图片路径
  qqbot-mcp --cli        强制进入交互式 CLI
  qqbot-mcp --no-qr      启动 CLI 时跳过二维码
  qqbot-mcp --help       显示帮助
  qqbot-mcp --version    显示版本

说明：
  无参数且 stdin/stdout 不是终端时，会自动按 --mcp 运行，兼容现有 MCP 客户端。
  二维码默认指向 QQ 机器人快速创建/登录入口，可用 QQBOT_MCP_QR_URL 覆盖。
  配置见 docs/CONFIGURATION.md，CLI 命令见 docs/CLI.md。
`;
}
