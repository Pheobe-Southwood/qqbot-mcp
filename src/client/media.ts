import { createWriteStream } from 'node:fs';
import { open, readFile, stat, unlink } from 'node:fs/promises';
import { extname } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Config } from '../config.js';
import type { Logger } from '../util/logger.js';
import { ToolError } from './errors.js';
import type { QqBotClient } from './http.js';
import { ensureDirectory, resolveUploadFile, sanitizeFilename, uniqueDownloadPath } from '../safety/paths.js';
import { hashBuffer, hashFile, hashFirstBytes } from '../util/hash.js';

export type UploadScene = 'c2c' | 'group';

export interface LocalUploadOptions {
  scene: UploadScene;
  targetId: string;
  filePath: string;
  fileType?: number;
  srvSendMsg?: boolean;
  signal?: AbortSignal;
}

export interface UrlUploadOptions {
  scene: UploadScene;
  targetId: string;
  url: string;
  fileType?: number;
  srvSendMsg?: boolean;
  signal?: AbortSignal;
}

export interface UploadResult {
  ok: true;
  scene: UploadScene;
  target_id: string;
  file_name: string;
  file_size: number;
  file_type: number;
  file_type_label: string;
  file_info: unknown;
  upload: unknown;
  downgraded?: string;
}

interface FileKind {
  type: number;
  label: string;
  limitBytes: number;
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v']);
const VOICE_EXT = new Set(['.silk', '.slk', '.amr', '.mp3', '.wav', '.ogg']);
const KIND_LABELS: Record<number, string> = { 1: 'image', 2: 'video', 3: 'voice', 4: 'file' };
const KIND_LIMITS: Record<number, number> = {
  1: 20 * 1024 * 1024,
  2: 30 * 1024 * 1024,
  3: 20 * 1024 * 1024,
  4: 200 * 1024 * 1024,
};

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.amr': 'audio/amr',
  '.silk': 'audio/silk',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
};

const MD5_10M_BYTES = 10_002_432;
const MARKDOWN_IMAGE_LIMIT = 10 * 1024 * 1024;

export class MediaService {
  constructor(
    private readonly client: QqBotClient,
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}

  detectKind(fileName: string, size: number): FileKind {
    const ext = extname(fileName).toLowerCase();
    let type = 4;
    if (IMAGE_EXT.has(ext)) type = 1;
    else if (VIDEO_EXT.has(ext)) type = 2;
    else if (VOICE_EXT.has(ext)) type = 3;
    return { type, label: KIND_LABELS[type] ?? 'file', limitBytes: KIND_LIMITS[type] ?? KIND_LIMITS[4]! };
  }

  async uploadLocal(options: LocalUploadOptions): Promise<UploadResult> {
    const path = await resolveUploadFile(options.filePath, this.config.uploadRoot);
    const info = await stat(path);
    if (info.size <= 0) throw new ToolError(`Refusing to upload empty file: ${options.filePath}`);
    if (info.size > this.config.maxUploadBytes) {
      throw new ToolError(
        `File is ${formatBytes(info.size)}, above the configured limit ${formatBytes(this.config.maxUploadBytes)}.`,
        { hint: 'QQ rich-media files are capped at 200MB.' },
      );
    }
    const fileName = sanitizeFilename(options.filePath.split(/[\\/]/).pop() || 'file');
    const detected = this.detectKind(fileName, info.size);
    let fileType = options.fileType ?? detected.type;
    if (!Number.isInteger(fileType) || fileType < 1 || fileType > 4) {
      throw new ToolError('file_type must be 1 (image), 2 (video), 3 (voice) or 4 (file).');
    }
    let downgraded: string | undefined;
    if (info.size > (KIND_LIMITS[fileType] ?? KIND_LIMITS[4]!)) {
      downgraded = `size ${formatBytes(info.size)} exceeds the ${KIND_LABELS[fileType]} soft limit; uploaded as file (type 4)`;
      fileType = 4;
    }

    const [md5, sha1, md5_10m] = await Promise.all([
      hashFile(path, 'md5'),
      hashFile(path, 'sha1'),
      hashFirstBytes(path, MD5_10M_BYTES, 'md5'),
    ]);

    const prepareName = options.scene === 'group' ? 'prepare_group_upload' : 'prepare_c2c_upload';
    const prepare = await this.client.call(prepareName, {
      path: options.scene === 'group' ? { group_id: options.targetId } : { user_id: options.targetId },
      body: {
        file_type: fileType,
        file_size: String(info.size),
        file_name: fileName,
        md5,
        sha1,
        md5_10m,
      },
      signal: options.signal,
    });
    const prepared = asRecord(prepare.data);
    const uploadId = typeof prepared.upload_id === 'string' ? prepared.upload_id : undefined;
    const blockSize = Number(prepared.block_size);
    const parts = Array.isArray(prepared.parts) ? prepared.parts : [];
    if (!uploadId || !Number.isFinite(blockSize) || blockSize <= 0 || parts.length === 0) {
      throw new ToolError('upload_prepare response is missing upload_id/block_size/parts.', {
        details: prepared,
      });
    }

    const uploadConfig = asRecord(prepared.upload_config);
    const concurrency = Math.min(4, Math.max(1, Number(uploadConfig.concurrency) || 1));
    this.logger.debug('Uploading rich media in parts.', {
      scene: options.scene,
      size: info.size,
      blockSize,
      parts: parts.length,
      concurrency,
    });
    await this.uploadParts({
      path,
      size: info.size,
      blockSize,
      parts,
      uploadId,
      scene: options.scene,
      targetId: options.targetId,
      concurrency,
      signal: options.signal,
    });

    const mergeName = options.scene === 'group' ? 'upload_group_file' : 'upload_c2c_file';
    const merged = await this.client.call(mergeName, {
      path: options.scene === 'group' ? { group_openid: options.targetId } : { user_openid: options.targetId },
      body: {
        file_type: fileType,
        file_name: fileName,
        upload_id: uploadId,
        srv_send_msg: options.srvSendMsg ?? false,
      },
      signal: options.signal,
    });
    const response = asRecord(merged.data);
    return {
      ok: true,
      scene: options.scene,
      target_id: options.targetId,
      file_name: fileName,
      file_size: info.size,
      file_type: fileType,
      file_type_label: KIND_LABELS[fileType] ?? 'file',
      file_info: response.file_info ?? response.file_uuid ?? response,
      upload: response,
      ...(downgraded ? { downgraded } : {}),
    };
  }

  async uploadUrl(options: UrlUploadOptions): Promise<UploadResult> {
    const fileType = options.fileType ?? 4;
    const mergeName = options.scene === 'group' ? 'upload_group_file' : 'upload_c2c_file';
    const merged = await this.client.call(mergeName, {
      path: options.scene === 'group' ? { group_openid: options.targetId } : { user_openid: options.targetId },
      body: {
        file_type: fileType,
        url: options.url,
        srv_send_msg: options.srvSendMsg ?? false,
      },
      signal: options.signal,
    });
    const response = asRecord(merged.data);
    return {
      ok: true,
      scene: options.scene,
      target_id: options.targetId,
      file_name: String(response.file_name ?? ''),
      file_size: Number(response.file_size ?? 0),
      file_type: fileType,
      file_type_label: KIND_LABELS[fileType] ?? 'file',
      file_info: response.file_info ?? response.file_uuid ?? response,
      upload: response,
    };
  }

  async readChannelImage(filePath: string): Promise<{ data: Uint8Array; filename: string; contentType: string; size: number }> {
    const path = await resolveUploadFile(filePath, this.config.uploadRoot);
    const info = await stat(path);
    const filename = sanitizeFilename(filePath.split(/[\\/]/).pop() || 'image.png');
    const ext = extname(filename).toLowerCase();
    if (!IMAGE_EXT.has(ext)) {
      throw new ToolError('Channel file_image supports local images only (png/jpg/gif/webp/bmp).');
    }
    if (info.size > this.config.maxUploadBytes) {
      throw new ToolError(`Image is ${formatBytes(info.size)}, above the ${formatBytes(this.config.maxUploadBytes)} limit.`);
    }
    return { data: await readFile(path), filename, contentType: MIME_BY_EXT[ext] ?? 'application/octet-stream', size: info.size };
  }

  async uploadMarkdownImage(filePath: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const path = await resolveUploadFile(filePath, this.config.uploadRoot);
    const info = await stat(path);
    const fileName = sanitizeFilename(filePath.split(/[\\/]/).pop() || 'image.png');
    const ext = extname(fileName).toLowerCase();
    if (!IMAGE_EXT.has(ext)) {
      throw new ToolError('Markdown images support png/jpeg/gif/webp only.', { details: { extension: ext } });
    }
    if (info.size > MARKDOWN_IMAGE_LIMIT) {
      throw new ToolError(`Markdown image is ${formatBytes(info.size)}; the limit is 10MB.`);
    }
    const [md5, sha1] = await Promise.all([hashFile(path, 'md5'), hashFile(path, 'sha1')]);
    const contentType = MIME_BY_EXT[ext] ?? 'application/octet-stream';
    const prepared = await this.client.call('prepare_media_image', {
      body: {
        file_name: fileName,
        file_size: String(info.size),
        content_type: contentType,
        md5,
        sha1,
      },
      signal,
    });
    const data = asRecord(prepared.data);
    const uploadId = typeof data.upload_id === 'string' ? data.upload_id : undefined;
    const presignedUrl = typeof data.presigned_url === 'string' ? data.presigned_url : undefined;
    if (!uploadId || !presignedUrl) {
      throw new ToolError('prepare_media_image response is missing upload_id/presigned_url.', { details: data });
    }
    const bytes = await readWholeFile(path);
    const put = await this.client.putPresigned(presignedUrl, bytes, contentType, signal);
    const complete = await this.client.call('complete_media_image', {
      body: { upload_id: uploadId, md5: put.etag || md5 },
      signal,
    });
    const completed = asRecord(complete.data);
    return {
      ok: true,
      image_id: completed.image_id,
      url: completed.url,
      preview_url: completed.preview_url,
      ttl: completed.ttl,
      markdown: completed.url ? `![](${String(completed.url)})` : undefined,
      response: completed,
    };
  }

  async download(
    url: string,
    options: { filename?: string; maxBytes?: number; signal?: AbortSignal } = {},
  ): Promise<Record<string, unknown>> {
    const maxBytes = Math.min(options.maxBytes ?? this.config.maxUploadBytes, this.config.maxUploadBytes);
    const finalUrl = await validateRemoteUrl(url);
    let current = finalUrl;
    let response: Response | undefined;
    for (let hop = 0; hop <= 3; hop++) {
      response = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.any([
          AbortSignal.timeout(Math.max(this.config.timeoutMs, 300_000)),
          ...(options.signal ? [options.signal] : []),
        ]),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => undefined);
        if (!location) throw new ToolError(`Redirect without Location from ${current}.`);
        current = await validateRemoteUrl(new URL(location, current).toString());
        continue;
      }
      break;
    }
    if (!response) throw new ToolError('Download failed before receiving a response.');
    if (!response.ok) {
      throw new ToolError(`Download failed with HTTP ${response.status}.`, { retryable: response.status >= 500 });
    }
    const length = Number(response.headers.get('content-length') ?? '0');
    if (length > maxBytes) {
      throw new ToolError(`Attachment is ${formatBytes(length)}, above the ${formatBytes(maxBytes)} limit.`);
    }
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const fileName = sanitizeFilename(options.filename || filenameFromUrl(current), 'attachment');
    await ensureDirectory(this.config.downloadDir);
    const finalPath = uniqueDownloadPath(this.config.downloadDir, fileName);
    if (!response.body) {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) throw new ToolError(`Attachment exceeds the ${formatBytes(maxBytes)} limit.`);
      await pipeline(Readable.from([buffer]), createWriteStream(finalPath, { mode: 0o600 }));
      return {
        ...this.downloadResult(finalPath, buffer.length, contentType, current),
        sha256: createHash('sha256').update(buffer).digest('hex'),
      };
    }
    const hash = createHash('sha256');
    let total = 0;
    const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    const counter = async function* (source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        total += chunk.length;
        if (total > maxBytes) {
          throw new ToolError(`Attachment exceeds the ${formatBytes(maxBytes)} limit.`);
        }
        hash.update(chunk);
        yield chunk;
      }
    };
    try {
      await pipeline(nodeStream, counter, createWriteStream(finalPath, { mode: 0o600 }));
    } catch (error) {
      await unlink(finalPath).catch(() => undefined);
      throw error;
    }
    return {
      ok: true,
      path: finalPath,
      size: total,
      content_type: contentType,
      url: current,
      sha256: hash.digest('hex'),
    };
  }

  private downloadResult(path: string, size: number, contentType: string, url: string): Record<string, unknown> {
    return { ok: true, path, size, content_type: contentType, url };
  }

  private async uploadParts(input: {
    path: string;
    size: number;
    blockSize: number;
    parts: unknown[];
    uploadId: string;
    scene: UploadScene;
    targetId: string;
    concurrency: number;
    signal?: AbortSignal;
  }): Promise<void> {
    const handle = await open(input.path, 'r');
    try {
      const finishName = input.scene === 'group' ? 'finish_group_upload_part' : 'finish_c2c_upload_part';
      const pathParam = input.scene === 'group' ? { group_id: input.targetId } : { user_id: input.targetId };
      let next = 0;
      const worker = async (): Promise<void> => {
        for (;;) {
          const slot = next++;
          if (slot >= input.parts.length) return;
          const part = input.parts[slot];
          const partRecord = asRecord(part);
          const presignedUrl =
            typeof part === 'string' ? part : typeof partRecord.presigned_url === 'string' ? partRecord.presigned_url : undefined;
          if (!presignedUrl) throw new ToolError(`upload_prepare part ${slot} has no presigned_url.`);
          const index = Number(partRecord.index ?? slot);
          const offset = index * input.blockSize;
          const length = Math.min(input.blockSize, input.size - offset);
          if (length <= 0) throw new ToolError(`Invalid upload part index ${index}.`);
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, offset);
          const chunk = buffer.subarray(0, bytesRead);
          let lastError: unknown;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              await this.client.putPresigned(presignedUrl, chunk, 'application/octet-stream', input.signal);
              await this.client.call(finishName, {
                path: pathParam,
                body: {
                  upload_id: input.uploadId,
                  part_index: index,
                  block_size: String(bytesRead),
                  md5: hashBuffer(chunk, 'md5'),
                },
                signal: input.signal,
              });
              lastError = undefined;
              break;
            } catch (error) {
              lastError = error;
              if (attempt === 0) await sleep(400);
            }
          }
          if (lastError) throw lastError;
        }
      };
      await Promise.all(Array.from({ length: Math.min(input.concurrency, input.parts.length) }, () => worker()));
    } finally {
      await handle.close().catch(() => undefined);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function readWholeFile(path: string): Promise<Uint8Array> {
  return readFile(path);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function filenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    return name || 'attachment';
  } catch {
    return 'attachment';
  }
}

/** Reject file:, localhost and obvious private-network targets (SSRF guard). */
export async function validateRemoteUrl(raw: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ToolError(`Invalid attachment URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ToolError('Only http(s) attachment URLs are allowed.');
  }
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '[::1]'
  ) {
    throw new ToolError('Refusing to download from a private/loopback address.');
  }
  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
