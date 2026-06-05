import { CliParseError } from './errors';
import type { AuditEventSort } from '@/domain/query/audit-event-query';
import type { AuditEventType } from '@/domain/event/audit-event';
import type { IntegrationAttemptStatus } from '@/domain/integration/integration-attempt';
import type { CountReportGroupBy } from '@/domain/query/report';
import type { WorkItemSort } from '@/domain/query/work-item-query';
import type { HealthStatus } from '@/primitives/health';
import type { IdempotencyStatus } from '@/primitives/idempotency';
import type { ProcessStatus } from '@/primitives/process-manager';
import { parseIsoTimestamp } from '@/primitives/time';

export function parseExpectedVersion(value?: string): number | undefined {
  if (value == null) return undefined;

  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new CliParseError('Expected version must be a positive integer', {
      expectedVersion: value,
    });
  }

  return version;
}

export function parsePositiveIntegerOption(name: string, value?: string): number | undefined {
  if (value == null) return undefined;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CliParseError(`${name} must be a positive integer`, { [name]: value });
  }

  return parsed;
}

export function parseNonNegativeIntegerOption(name: string, value?: string): number | undefined {
  if (value == null) return undefined;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliParseError(`${name} must be a non-negative integer`, { [name]: value });
  }

  return parsed;
}

export function parseWorkItemSort(value?: string): WorkItemSort | undefined {
  return parseChoice('sort', value, [
    'created_at_desc',
    'created_at_asc',
    'updated_at_desc',
    'updated_at_asc',
  ]);
}

export function parseAuditEventSort(value?: string): AuditEventSort | undefined {
  return parseChoice('sort', value, ['occurred_at_desc', 'occurred_at_asc']);
}

export function parseAuditEventType(value?: string): AuditEventType | undefined {
  return parseChoice('type', value, [
    'WorkItemCreated',
    'WorkItemFieldsUpdated',
    'WorkItemTransitioned',
    'WorkItemAssigned',
    'DecisionAdded',
    'CommentAdded',
    'ResourceCreated',
    'ResourceReserved',
    'ResourceReservationReleased',
  ]);
}

export function parseCountReportGroupBy(value: string): CountReportGroupBy {
  const groupBy = parseChoice('groupBy', value, ['status', 'type']);
  if (groupBy == null) {
    throw new CliParseError('groupBy is required');
  }
  return groupBy;
}

export function parseIntegrationAttemptStatus(
  value?: string
): IntegrationAttemptStatus | undefined {
  return parseChoice('status', value, ['pending', 'succeeded', 'failed', 'skipped']);
}

export function parseProcessStatus(value?: string): ProcessStatus | undefined {
  return parseChoice('status', value, [
    'running',
    'waiting',
    'completed',
    'failed',
    'compensating',
    'compensated',
    'cancelled',
  ]);
}

export function parseHealthStatus(value?: string): HealthStatus | undefined {
  return parseChoice('status', value, ['pass', 'warn', 'fail']);
}

export function parseIdempotencyStatus(value?: string): IdempotencyStatus | undefined {
  return parseChoice('status', value, ['started', 'succeeded', 'failed']);
}

export function parseIsoTimestampOption(name: string, value: string): string {
  const parsed = parseIsoTimestamp(value, name);
  if (!parsed.ok) {
    throw new CliParseError(`${name} must be an ISO timestamp`, { [name]: value });
  }
  return parsed.value;
}

function parseChoice<const T extends readonly string[]>(
  name: string,
  value: string | undefined,
  choices: T
): T[number] | undefined {
  if (value == null) return undefined;
  if (choices.includes(value)) return value;

  throw new CliParseError(`${name} must be one of: ${choices.join(', ')}`, {
    [name]: value,
    choices,
  });
}
