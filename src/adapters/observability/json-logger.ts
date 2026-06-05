import { type LogEntry, type LoggerTransport, safeStringifyLogValue } from '@/ports/logger';
import { StructuredLogger, type StructuredLoggerOptions } from './structured-logger';

export class JsonLogTransport implements LoggerTransport {
  write(entry: LogEntry): void {
    console.log(safeStringifyLogValue(entry));
  }
}

export class JsonLogger extends StructuredLogger {
  constructor(options: StructuredLoggerOptions) {
    super({
      ...options,
      transports: options.transports ?? [new JsonLogTransport()],
    });
  }
}
