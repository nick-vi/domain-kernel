export { FsCache } from './fs-cache';
export { FsCommandIdempotencyStore } from './fs-command-idempotency-store';
export { FsDomainPackageRepository } from './fs-domain-package-repository';
export { FsEventStore } from './fs-event-store';
export { FsIntegrationAttemptRepository } from './fs-integration-attempt-repository';
export {
  createFilesystemKernelDependencies,
  type FilesystemKernelDependenciesOptions,
} from './fs-kernel';
export { FsHealthReporter } from './fs-health-reporter';
export { FsMetricsRecorder } from './fs-metrics-recorder';
export { FsMigrationStateRepository } from './fs-migration-state-repository';
export { FsOutboxRepository } from './fs-outbox-repository';
export { FsProcessStore } from './fs-process-store';
export { FsProjectionStore } from './fs-projection-store';
export { FsResourceRepository } from './fs-resource-repository';
export { FsResourceReservationPort } from './fs-resource-reservation-port';
export { FsSyncStateRepository } from './fs-sync-state-repository';
export { RandomFileTempNames } from './fs-temp-names';
export { FsUnitOfWorkManager } from './fs-unit-of-work-manager';
export { FsWorkItemRepository } from './fs-work-item-repository';
export { FsWorkflowRepository } from './fs-workflow-repository';
export {
  appendJsonl,
  DEFAULT_FILE_LOCK_RETRY_DELAY_MS,
  DEFAULT_FILE_LOCK_STALE_MS,
  DEFAULT_FILE_LOCK_TIMEOUT_MS,
  ensureDir,
  filenameForId,
  hashFile,
  jsonlFilenameForId,
  listFilesRecursive,
  loadConfigFile,
  pathExists,
  readJson,
  readJsonl,
  removePath,
  resolveProjectRoot,
  safeJoin,
  withFileLock,
  writeJsonAtomic,
  writeTempThenRename,
  type FileLockOptions,
  type FileTempNames,
} from './fs-utils';
