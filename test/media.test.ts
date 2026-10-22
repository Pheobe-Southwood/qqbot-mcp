import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaService, validateRemoteUrl } from '../src/client/media.js';
import type { QqBotClient } from '../src/client/http.js';
import { resolveConfig, type Config } from '../src/config.js';
import { Logger } from '../src/util/logger.js';
import { resolveUploadFile } from '../src/safety/paths.js';

const logger = new Logger('error');
let root: string;
let service: MediaService;
let calls: Array<{ api: string; options: Record<string, unknown> }>;
let puts: Array<{ url: string; data: Buffer; contentType: string }>;
let fake: QqBotClient;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'qqbot-media-'));
  calls = [];
  puts = [];
  fake = {
    call: vi.fn(async (api: string, options: Record<string, unknown>) => {
      calls.push({ api, options });
      if (api === 'prepare_group_upload') {
        return {
          ok: true,
          httpStatus: 200,
          data: {
            upload_id: 'UPLOAD-1',
            block_size: 4,
            parts: [
              { index: 0, presigned_url: 'https://cos.test/0' },
              { index: 1, presigned_url: 'https://cos.test/1' },
              { index: 2, presigned_url: 'https://cos.test/2' },
            ],
            upload_config: { concurrency: 1 },
          },
          url: '',
        };
      }
      if (api === 'upload_group_file') {
        return { ok: true, httpStatus: 200, data: { file_info: 'FILE-INFO' }, url: '' };
      }
      if (api === 'prepare_media_image') {
        return {
          ok: true,
          httpStatus: 200,
          data: { upload_id: 'IMG-UPLOAD', presigned_url: 'https://cos.test/img', expires_in: 3600 },
          url: '',
        };
      }
      if (api === 'complete_media_image') {
        return {
          ok: true,
          httpStatus: 200,
          data: {
            image_id: 'IMG-1',
            url: 'qqbot-media://image/v1/abc',
            preview_url: 'https://preview.test/abc',
            ttl: 3600,
          },
          url: '',
        };
      }
      return { ok: true, httpStatus: 200, data: {}, url: '' };
    }),
    putPresigned: vi.fn(async (url: string, data: Uint8Array, contentType: string) => {
      puts.push({ url, data: Buffer.from(data), contentType });
      return { etag: 'ETAG' };
    }),
  } as unknown as QqBotClient;
  const config: Config = {
    ...resolveConfig({ QQBOT_ACCESS_TOKEN: 'tok', QQBOT_MCP_MODE: 'write' }).config,
    uploadRoot: root,
    maxUploadBytes: 200 * 1024 * 1024,
    rateLimit: false,
  };
  service = new MediaService(fake, config, logger);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('local upload path fence', () => {
  it('resolves files inside the root and rejects escapes', async () => {
    await writeFile(join(root, 'ok.txt'), 'ok');
    await expect(resolveUploadFile('ok.txt', root)).resolves.toContain('ok.txt');
    await expect(resolveUploadFile('../outside.txt', root)).rejects.toThrow(/outside|not found/);
    await expect(resolveUploadFile('/etc/passwd', root)).rejects.toThrow(/outside/);
  });
});

describe('MediaService rich media upload', () => {
  it('hashes, uploads parts, finishes each part and merges', async () => {
    const content = Buffer.from('0123456789');
    await writeFile(join(root, 'a.bin'), content);
    const result = await service.uploadLocal({ scene: 'group', targetId: 'GROUP-1', filePath: 'a.bin' });
    expect(result).toMatchObject({
      ok: true,
      scene: 'group',
      target_id: 'GROUP-1',
      file_name: 'a.bin',
      file_size: 10,
      file_type: 4,
      file_info: 'FILE-INFO',
    });
    const prepare = calls.find((call) => call.api === 'prepare_group_upload')!;
    expect(prepare.options).toMatchObject({
      path: { group_id: 'GROUP-1' },
      body: { file_type: 4, file_size: '10', file_name: 'a.bin' },
    });
    expect((prepare.options.body as Record<string, unknown>).md5).toMatch(/^[0-9a-f]{32}$/);
    expect((prepare.options.body as Record<string, unknown>).sha1).toMatch(/^[0-9a-f]{40}$/);
    expect((prepare.options.body as Record<string, unknown>).md5_10m).toMatch(/^[0-9a-f]{32}$/);

    expect(puts.map((put) => put.url)).toEqual(['https://cos.test/0', 'https://cos.test/1', 'https://cos.test/2']);
    expect(Buffer.concat(puts.map((put) => put.data))).toEqual(content);
    const finishes = calls.filter((call) => call.api === 'finish_group_upload_part');
    expect(finishes.map((call) => call.options)).toEqual([
      { path: { group_id: 'GROUP-1' }, body: { upload_id: 'UPLOAD-1', part_index: 0, block_size: '4', md5: expect.any(String) } },
      { path: { group_id: 'GROUP-1' }, body: { upload_id: 'UPLOAD-1', part_index: 1, block_size: '4', md5: expect.any(String) } },
      { path: { group_id: 'GROUP-1' }, body: { upload_id: 'UPLOAD-1', part_index: 2, block_size: '2', md5: expect.any(String) } },
    ]);
    const merge = calls.find((call) => call.api === 'upload_group_file')!;
    expect(merge.options).toMatchObject({
      path: { group_openid: 'GROUP-1' },
      body: { file_type: 4, file_name: 'a.bin', upload_id: 'UPLOAD-1', srv_send_msg: false },
    });
  });

  it('classifies common extensions and downgrades oversized images', async () => {
    expect(service.detectKind('a.png', 10)).toMatchObject({ type: 1, label: 'image' });
    expect(service.detectKind('a.mp4', 10)).toMatchObject({ type: 2, label: 'video' });
    expect(service.detectKind('a.silk', 10)).toMatchObject({ type: 3, label: 'voice' });
    expect(service.detectKind('a.pdf', 10)).toMatchObject({ type: 4, label: 'file' });
  });

  it('uploads a Markdown image and returns a qqbot-media URL', async () => {
    await writeFile(join(root, 'pic.png'), Buffer.from('PNG!'));
    const result = await service.uploadMarkdownImage('pic.png');
    expect(result).toMatchObject({
      ok: true,
      image_id: 'IMG-1',
      url: 'qqbot-media://image/v1/abc',
      markdown: '![](qqbot-media://image/v1/abc)',
    });
    expect(puts[0]).toMatchObject({ url: 'https://cos.test/img', contentType: 'image/png' });
    const complete = calls.find((call) => call.api === 'complete_media_image')!;
    expect(complete.options).toMatchObject({ body: { upload_id: 'IMG-UPLOAD', md5: 'ETAG' } });
  });
});

describe('attachment download guard', () => {
  it('rejects private/loopback URLs and non-http schemes', async () => {
    await expect(validateRemoteUrl('http://127.0.0.1/a')).rejects.toThrow(/private/);
    await expect(validateRemoteUrl('http://192.168.1.1/a')).rejects.toThrow(/private/);
    await expect(validateRemoteUrl('file:///etc/passwd')).rejects.toThrow(/http/);
    await expect(validateRemoteUrl('https://example.com/a.png')).resolves.toBe('https://example.com/a.png');
  });
});
