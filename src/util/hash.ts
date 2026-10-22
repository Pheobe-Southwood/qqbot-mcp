import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export type HashAlgorithm = 'md5' | 'sha1' | 'sha256';

export async function hashFile(path: string, algorithm: HashAlgorithm): Promise<string> {
  const hash = createHash(algorithm);
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });
  return hash.digest('hex');
}

export async function hashFirstBytes(path: string, bytes: number, algorithm: HashAlgorithm = 'md5'): Promise<string> {
  const hash = createHash(algorithm);
  let remaining = bytes;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path, { start: 0, end: Math.max(0, bytes - 1) });
    stream.on('data', (chunk) => {
      if (remaining <= 0) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const slice = buffer.subarray(0, remaining);
      hash.update(slice);
      remaining -= slice.length;
      if (remaining <= 0) stream.destroy();
    });
    stream.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ERR_STREAM_PREMATURE_CLOSE') return;
      reject(error);
    });
    stream.on('end', () => resolve());
    stream.on('close', () => resolve());
  });
  return hash.digest('hex');
}

export function hashBuffer(buffer: Uint8Array, algorithm: HashAlgorithm): string {
  return createHash(algorithm).update(buffer).digest('hex');
}
