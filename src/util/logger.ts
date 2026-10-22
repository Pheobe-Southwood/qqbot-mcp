// stderr-only logger: stdout is reserved for the MCP JSON-RPC stream.
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  constructor(private readonly level: LogLevel = 'info') {}

  child(_scope: string): Logger {
    return this;
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this.write('debug', message, fields);
  }
  info(message: string, fields?: Record<string, unknown>): void {
    this.write('info', message, fields);
  }
  warn(message: string, fields?: Record<string, unknown>): void {
    this.write('warn', message, fields);
  }
  error(message: string, fields?: Record<string, unknown>): void {
    this.write('error', message, fields);
  }

  private write(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LEVELS[level] < LEVELS[this.level]) return;
    const suffix = fields && Object.keys(fields).length > 0 ? ` ${safeJson(fields)}` : '';
    process.stderr.write(`[qqbot-mcp] ${level} ${message}${suffix}\n`);
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}
