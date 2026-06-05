import type { Logger } from '@/ports/logger';

export class NoopLogger implements Logger {
  trace(): void {}
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  fatal(): void {}
  child(): Logger {
    return this;
  }
  async flush(): Promise<void> {}
  async close(): Promise<void> {}
}
