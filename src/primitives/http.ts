import { Json } from './json';
import { Err, Ok, type Result } from './result';
import { optionalNonNegativeIntegerOption } from './runtime-options';
import type { SafeParseSchema } from './schema';

export const HttpErrorKind = Object.freeze({
  Http: 'http',
  Network: 'network',
  Timeout: 'timeout',
  Aborted: 'aborted',
  Parse: 'parse',
  Validation: 'validation',
} as const);

export type HttpErrorKind = (typeof HttpErrorKind)[keyof typeof HttpErrorKind];

export class HttpError extends Error {
  override readonly name = 'HttpError';

  constructor(
    readonly kind: HttpErrorKind,
    message: string,
    readonly url: string,
    readonly status?: number | undefined,
    options?: { cause?: unknown } | undefined
  ) {
    super(message, options);
  }
}

export type RequestJsonOptions<T> = {
  fetch: FetchTransport;
  abortSignals?: RequestAbortSignals | undefined;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | undefined;
  headers?: Readonly<Record<string, string>> | undefined;
  body?: unknown;
  schema?: SafeParseSchema<T> | undefined;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
};

export type FetchTransport = (url: string, init: RequestInit) => Promise<Response>;

export type RequestAbortSignals = {
  timeout(milliseconds: number): AbortSignal;
  any(signals: readonly AbortSignal[]): AbortSignal;
};

export async function requestJson<T = unknown>(
  url: string,
  options: RequestJsonOptions<T>
): Promise<Result<T, HttpError>> {
  const {
    fetch: fetchTransport,
    abortSignals,
    method = 'GET',
    headers,
    body,
    schema,
    signal,
    timeoutMs: rawTimeoutMs,
  } = options;
  const timeoutMs = optionalNonNegativeIntegerOption('timeoutMs', rawTimeoutMs);
  assertRequestJsonOptions(fetchTransport, timeoutMs, abortSignals);

  const timeoutSignal =
    timeoutMs == null ? undefined : abortSignals?.timeout(timeoutMs);
  const requestSignal = resolveRequestSignal(signal, timeoutSignal, abortSignals);

  try {
    const init: RequestInit = {
      method,
      ...(requestSignal != null ? { signal: requestSignal } : {}),
      headers: {
        accept: 'application/json',
        ...(body !== undefined && typeof body !== 'string'
          ? { 'content-type': 'application/json' }
          : {}),
        ...headers,
      },
    };
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const response = await fetchTransport(url, init);

    if (!response.ok) {
      return Err(
        new HttpError(
          HttpErrorKind.Http,
          `${method} ${url} -> ${response.status}`,
          url,
          response.status
        )
      );
    }

    const parsed = Json.parse<T>(await response.text(), schema == null ? {} : { schema });
    if (parsed.ok) return Ok(parsed.value);

    const kind =
      parsed.error.name === 'JsonValidationError'
        ? HttpErrorKind.Validation
        : HttpErrorKind.Parse;

    return Err(
      new HttpError(kind, `${method} ${url}: ${parsed.error.message}`, url, response.status, {
        cause: parsed.error,
      })
    );
  } catch (error) {
    if (timeoutSignal?.aborted === true && signal?.aborted !== true) {
      return Err(
        new HttpError(HttpErrorKind.Timeout, `${method} ${url} timed out after ${timeoutMs}ms`, url)
      );
    }
    if (signal?.aborted === true) {
      return Err(new HttpError(HttpErrorKind.Aborted, `${method} ${url} aborted`, url));
    }
    return Err(
      new HttpError(
        HttpErrorKind.Network,
        `${method} ${url}: ${error instanceof Error ? error.message : 'network error'}`,
        url,
        undefined,
        { cause: error }
      )
    );
  }
}

function assertRequestJsonOptions(
  fetchTransport: FetchTransport,
  timeoutMs: number | undefined,
  abortSignals: RequestAbortSignals | undefined
): void {
  if (typeof fetchTransport !== 'function') {
    throw new Error('requestJson fetch transport is required');
  }
  if (timeoutMs != null && abortSignals == null) {
    throw new Error('requestJson abortSignals is required when timeoutMs is set');
  }
}

function resolveRequestSignal(
  signal: AbortSignal | undefined,
  timeoutSignal: AbortSignal | undefined,
  abortSignals: RequestAbortSignals | undefined
): AbortSignal | undefined {
  const signals = [signal, timeoutSignal].filter((item): item is AbortSignal => item != null);
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  if (abortSignals == null) {
    throw new Error('requestJson abortSignals is required to compose abort signals');
  }
  return abortSignals.any(signals);
}
