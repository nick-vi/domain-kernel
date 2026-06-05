import { describe, expect, it } from 'vitest';
import * as kernel from '@/index';
import * as cli from '@/cli';

describe('public API', () => {
  it('exposes the kernel layers through stable namespaces', () => {
    expect(Object.keys(kernel).sort()).toEqual([
      'application',
      'authorizationAdapters',
      'domain',
      'eventAdapters',
      'filesystemAdapters',
      'memoryAdapters',
      'observabilityAdapters',
      'policyAdapters',
      'ports',
      'primitives',
      'queryAdapters',
      'resourceAdapters',
      'validation',
    ]);
    expect(kernel.primitives.Result).toBeDefined();
    expect(kernel.primitives.RuntimeOptionError).toBeDefined();
    expect(kernel.application.CommandBus).toBeDefined();
    expect(kernel.application.buildPackageEvolutionReport).toBeDefined();
    expect(kernel.application.checkContractCompatibility).toBeDefined();
    expect(kernel.application.verifyProjection).toBeDefined();
    expect(kernel.domain.createWorkItem).toBeDefined();
    expect(kernel.ports.SpanKind).toBeDefined();
    expect(kernel.memoryAdapters.InMemoryCommandIdempotencyStore).toBeDefined();
    expect(kernel.memoryAdapters.createMemoryKernelDependencies).toBeDefined();
    expect(kernel.memoryAdapters.InMemoryUnitOfWorkManager).toBeDefined();
    expect(kernel.memoryAdapters.InMemoryWorkItemRepository).toBeDefined();
    expect(kernel.filesystemAdapters.FsCommandIdempotencyStore).toBeDefined();
    expect(kernel.filesystemAdapters.createFilesystemKernelDependencies).toBeDefined();
    expect(kernel.filesystemAdapters.FsUnitOfWorkManager).toBeDefined();
    expect(kernel.filesystemAdapters.FsWorkItemRepository).toBeDefined();
  });

  it('exposes the CLI program factory through the CLI entrypoint', () => {
    expect(cli.createProgram).toBeDefined();
  });
});
