import type { JsonObject } from './json-value';

export const HealthStatus = Object.freeze({
  Pass: 'pass',
  Warn: 'warn',
  Fail: 'fail',
} as const);

export type HealthStatus = (typeof HealthStatus)[keyof typeof HealthStatus];

export type HealthCheckResult = {
  name: string;
  status: HealthStatus;
  checkedAt: string;
  message?: string | undefined;
  details?: JsonObject | undefined;
};

export function healthCheckResult(input: HealthCheckResult): HealthCheckResult {
  if (input.name.trim().length === 0) {
    throw new HealthError('Health check name must not be empty');
  }

  return {
    name: input.name,
    status: input.status,
    checkedAt: input.checkedAt,
    ...(input.message != null ? { message: input.message } : {}),
    ...(input.details != null ? { details: input.details } : {}),
  };
}

export class HealthError extends Error {
  override readonly name = 'HealthError';
}
