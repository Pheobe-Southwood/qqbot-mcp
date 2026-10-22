import { constants } from 'node:fs';
import { access, mkdir, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ToolError } from '../client/errors.js';

/**
 * Local file access fence. Any path used for upload MUST live under the
 * configured root (QQBOT_MCP_UPLOAD_ROOT), after symlink resolution.
 */
export async function resolveUploadFile(filePath: string, root: string | undefined): Promise<string> {
  if (!root) {
    throw new ToolError('Local file uploads are disabled: QQBOT_MCP_UPLOAD_ROOT is not set.', {
      hint: 'Set QQBOT_MCP_UPLOAD_ROOT to a directory containing the files the agent may upload, then restart.',
    });
  }
  const resolvedRoot = await realpath(root).catch(() => {
    throw new ToolError(`QQBOT_MCP_UPLOAD_ROOT does not exist: ${root}`);
  });
  const absolute = isAbsolute(filePath) ? filePath : resolve(resolvedRoot, filePath);
  const resolvedFile = await realpath(absolute).catch(() => {
    throw new ToolError(`File not found: ${filePath}`, {
      hint: 'Paths are resolved inside QQBOT_MCP_UPLOAD_ROOT.',
    });
  });
  const rel = relative(resolvedRoot, resolvedFile);
  if (rel.startsWith('..') || rel.split(sep).includes('..') || isAbsolute(rel)) {
    throw new ToolError(`Refusing to read a file outside QQBOT_MCP_UPLOAD_ROOT: ${filePath}`);
  }
  const info = await stat(resolvedFile);
  if (!info.isFile()) throw new ToolError(`Not a regular file: ${filePath}`);
  await access(resolvedFile, constants.R_OK).catch(() => {
    throw new ToolError(`File is not readable: ${filePath}`);
  });
  return resolvedFile;
}

export async function ensureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
}

export function sanitizeFilename(name: string, fallback = 'attachment'): string {
  const base = basename(name || fallback)
    .replace(/[^\w.\-()\u4e00-\u9fff]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return base || fallback;
}

export function uniqueDownloadPath(directory: string, filename: string): string {
  const safe = sanitizeFilename(filename);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(directory, `${stamp}-${safe}`);
}
