import {
  LogLevel,
  type LogContext,
  type LogEntry,
  type LoggerTransport,
  safeStringifyLogValue,
} from '@/ports/logger';
import { StructuredLogger, type StructuredLoggerOptions } from './structured-logger';

export type ConsoleLoggerOptions = StructuredLoggerOptions & {
  pretty?: boolean | undefined;
};

export class ConsoleLogTransport implements LoggerTransport {
  constructor(private readonly pretty = true) {}

  write(entry: LogEntry): void {
    if (!this.pretty) {
      console.log(safeStringifyLogValue(entry));
      return;
    }

    const { level, levelLabel, time, message, ...context } = entry;
    const prefix = `[${time}] ${levelLabel.toUpperCase()}`;
    const output = message.length > 0 ? `${prefix} ${message}` : prefix;
    const logger = consoleMethodFor(levelLabel);

    if (Object.keys(context).length > 0) {
      logger(output, context);
    } else {
      logger(output);
    }
  }
}

export class ConsoleLogger extends StructuredLogger {
  constructor(options: ConsoleLoggerOptions) {
    super({
      ...options,
      transports: options.transports ?? [new ConsoleLogTransport(options.pretty)],
    });
  }
}

function consoleMethodFor(level: LogLevel): (message: string, context?: LogContext) => void {
  switch (level) {
    case LogLevel.TRACE:
    case LogLevel.DEBUG:
      return console.debug;
    case LogLevel.INFO:
      return console.info;
    case LogLevel.WARN:
      return console.warn;
    case LogLevel.ERROR:
    case LogLevel.FATAL:
      return console.error;
  }
}
