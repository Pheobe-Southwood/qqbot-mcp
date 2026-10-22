import { chmod, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import QRCode from 'qrcode';

export const DEFAULT_QR_URL =
  'https://q.qq.com/qqbot/openclaw/login.html?redirect_url=https%3A%2F%2Fq.qq.com%2Fqqbot%2Fopenclaw%2F';

export interface QrArtifact {
  url: string;
  terminal: string;
  imagePath: string;
}

export function resolveQrUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.QQBOT_MCP_QR_URL?.trim();
  const value = configured || DEFAULT_QR_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('only http(s) URLs are supported');
    }
    return url.toString();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[qqbot-mcp] 二维码链接无效（${message}），改用默认链接。\n`);
    return DEFAULT_QR_URL;
  }
}

export function qrEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.QQBOT_MCP_QR ?? 'on').trim().toLowerCase();
  return !['off', 'false', '0', 'no', 'none'].includes(value);
}

export async function generateQr(
  url: string = DEFAULT_QR_URL,
  options: { dir?: string; now?: number } = {},
): Promise<QrArtifact> {
  const now = options.now ?? Date.now();
  let directory = options.dir?.trim();
  if (directory) {
    directory = resolve(directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
  } else {
    directory = await mkdtemp(join(tmpdir(), 'qqbot-mcp-qr-'));
  }

  const imagePath = join(directory, `qqbot-mcp-qr-${now}.png`);
  await QRCode.toFile(imagePath, url, {
    type: 'png',
    width: 512,
    margin: 2,
    errorCorrectionLevel: 'M',
  });
  await chmod(imagePath, 0o600);

  const terminal = await QRCode.toString(url, {
    type: 'utf8',
    margin: 2,
    errorCorrectionLevel: 'M',
  });

  return { url, terminal, imagePath };
}

export function formatQr(artifact: QrArtifact): string {
  return [
    '扫码创建/连接 QQ 机器人：',
    artifact.url,
    '',
    artifact.terminal.trimEnd(),
    '',
    `二维码图片：${artifact.imagePath}`,
    '',
  ].join('\n');
}
