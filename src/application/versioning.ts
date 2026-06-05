import { VersionConflictError } from '@/domain/errors/domain-error';
import type { WorkItem } from '@/domain/work-item/work-item';

export function assertExpectedVersion(workItem: WorkItem, expectedVersion?: number): void {
  if (expectedVersion == null) return;
  if (workItem.version === expectedVersion) return;

  throw new VersionConflictError(expectedVersion, workItem.version, {
    workItemId: workItem.id,
  });
}
