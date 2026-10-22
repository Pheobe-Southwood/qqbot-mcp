// tsc does not copy JSON assets into dist/, so do it explicitly.
import { chmodSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const from = join(process.cwd(), 'src', 'generated');
const to = join(process.cwd(), 'dist', 'generated');
mkdirSync(to, { recursive: true });
for (const file of readdirSync(from)) {
  if (file.endsWith('.json')) copyFileSync(join(from, file), join(to, file));
}
for (const entry of ['cli.js', 'server.js']) {
  try {
    chmodSync(join(process.cwd(), 'dist', entry), 0o755);
  } catch {
    // Windows / unusual filesystems: npm's bin shim still works.
  }
}
console.error(`Copied generated catalog JSON to ${to}`);
