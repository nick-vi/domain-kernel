import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { StaticAuthorizer } from '@/adapters/authorization';
import { NoopEventPublisher } from '@/adapters/events';
import { createMemoryKernelDependencies } from '@/adapters/memory';
import { InMemoryProjectionStore } from '@/adapters/memory/memory-projection-store';
import { NoopLogger } from '@/adapters/observability/noop-logger';
import { NoopTracer } from '@/adapters/observability/noop-tracer';
import { AllowAllPolicyEngine } from '@/adapters/policy';
import {
  assertPackageUpgradeAllowed,
  buildPackageEvolutionReport,
  checkPackageCompatibility,
  checkContractCompatibility,
  CommandBus,
  compareProjectionRecords,
  createDefaultCommandBus,
  createKernelProjections,
  ContractKind,
  KernelCommandType,
  KernelProjectionName,
  rebuildProjection,
  resolveKernelConfig,
  runAuditOutboxWorker,
  runPackageMigrations,
  verifyProjection,
} from '@/application';
import {
  addCommentUseCase,
  createResourceUseCase,
  createWorkItemUseCase,
  registerDomainPackage,
  releaseResourceReservationUseCase,
  reserveResourceUseCase,
  transitionWorkItemUseCase,
} from '@/application/use-cases';
import type { DomainPackage, FieldSchema } from '@/domain/package/domain-package';
import type { NormalizedWorkflowDefinition } from '@/domain/workflow/workflow-definition';
import { command } from '@/primitives/command';
import { RuntimeOptionError } from '@/primitives';
import {
  adminActor,
  createMemoryDeps,
  sampleOrderFieldSchema,
  sampleOrderWorkflow,
  SequenceClock,
  SequenceIdGenerator,
} from '../../support/application';

describe('kernel application services', () => {
  it('resolves typed config from explicit options, namespaced env, and defaults', () => {
    const config = resolveKernelConfig({
      logs: 'json',
      trace: true,
      env: {
        DOMAIN_KERNEL_DATA_DIR: '/tmp/domain-kernel',
        DATA_DIR: '/tmp/ignored',
        DOMAIN_KERNEL_ACTOR: 'operator',
        DOMAIN_KERNEL_ACTOR_ROLES: 'operator,custom',
      },
    });

    expect(config.dataDir.value).toBe('/tmp/domain-kernel');
    expect(config.dataDir.source).toBe('env');
    expect(config.actorId.value).toBe('operator');
    expect(config.actorRoles.value).toEqual(['operator', 'custom']);
    expect(config.logs).toEqual({ value: 'json', source: 'option' });
    expect(config.trace).toEqual({ value: true, source: 'option' });
  });

  it('dispatches registered commands with schema validation and safe results', async () => {
    const deps = createMemoryDeps();
    const bus = new CommandBus(deps).register({
      type: 'test.echo',
      unitOfWork: true,
      payload: {
        schema: z.object({ message: z.string().min(1) }),
      },
      handle: ({ command }) => ({ echoed: command.payload.message }),
    });

    await expect(
      bus.dispatch(
        command({
          id: 'cmd_001',
          type: 'test.echo',
          payload: { message: 'hello' },
          occurredAt: deps.clock.now(),
        })
      )
    ).resolves.toEqual({ echoed: 'hello' });

    const invalid = await bus.safeDispatch(
      command({
        id: 'cmd_002',
        type: 'test.echo',
        payload: { message: '' },
        occurredAt: deps.clock.now(),
      })
    );

    expect(invalid.ok).toBe(false);
  });

  it('replays command results when an idempotency key is retried', async () => {
    const deps = createMemoryDeps();
    let handled = 0;
    const bus = new CommandBus(deps).register({
      type: 'test.create',
      payload: {
        schema: z.object({ name: z.string().min(1) }),
      },
      handle: ({ command }) => {
        handled += 1;
        return { id: `created_${handled}`, name: command.payload.name };
      },
    });

    const first = await bus.dispatch<{ id: string; name: string }>(
      command({
        id: 'cmd_001',
        type: 'test.create',
        payload: { name: 'one' },
        idempotencyKey: 'idem_create_one',
        occurredAt: deps.clock.now(),
      })
    );
    const second = await bus.dispatch<{ id: string; name: string }>(
      command({
        id: 'cmd_002',
        type: 'test.create',
        payload: { name: 'one' },
        idempotencyKey: 'idem_create_one',
        occurredAt: deps.clock.now(),
      })
    );

    expect(first).toEqual({ id: 'created_1', name: 'one' });
    expect(second).toEqual(first);
    expect(handled).toBe(1);
    await expect(deps.commandIdempotency.get('idem_create_one')).resolves.toMatchObject({
      commandType: 'test.create',
      status: 'succeeded',
    });

    await expect(
      bus.dispatch(
        command({
          id: 'cmd_003',
          type: 'test.create',
          payload: { name: 'two' },
          idempotencyKey: 'idem_create_one',
          occurredAt: deps.clock.now(),
        })
      )
    ).rejects.toThrow(/different request/);
  });

  it('expires command idempotency replay records when the bus is configured with a replay TTL', async () => {
    const deps = createMemoryDeps();
    let handled = 0;
    const bus = new CommandBus(deps, { idempotencyReplayTtlMs: 1_000 }).register({
      type: 'test.ttl',
      handle: () => {
        handled += 1;
        return { handled };
      },
    });

    await expect(
      bus.dispatch(
        command({
          id: 'cmd_ttl_001',
          type: 'test.ttl',
          payload: {},
          idempotencyKey: 'idem_ttl',
          occurredAt: '2026-06-02T17:40:00.000Z',
        })
      )
    ).resolves.toEqual({ handled: 1 });
    await expect(deps.commandIdempotency.get('idem_ttl')).resolves.toMatchObject({
      replayExpiresAt: '2026-06-02T17:41:23.000Z',
    });

    await deps.commandIdempotency.pruneExpired({
      now: '2026-06-02T17:42:00.000Z',
    });
    await expect(
      bus.dispatch(
        command({
          id: 'cmd_ttl_002',
          type: 'test.ttl',
          payload: {},
          idempotencyKey: 'idem_ttl',
          occurredAt: '2026-06-02T17:41:00.000Z',
        })
      )
    ).resolves.toEqual({ handled: 2 });
  });

  it('records an in-progress idempotency lease before command handling completes', async () => {
    const deps = createMemoryDeps();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handlerEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const bus = new CommandBus(deps, { idempotencyInProgressTtlMs: 1_000 }).register({
      type: 'test.in_progress_lease',
      handle: async () => {
        entered();
        await gate;
        return { ok: true };
      },
    });

    const pending = bus.dispatch(
      command({
        id: 'cmd_in_progress_lease',
        type: 'test.in_progress_lease',
        payload: {},
        idempotencyKey: 'idem_in_progress_lease',
        occurredAt: '2026-06-02T17:40:00.000Z',
      })
    );

    await handlerEntered;
    await expect(deps.commandIdempotency.get('idem_in_progress_lease')).resolves.toMatchObject({
      status: 'started',
      inProgressExpiresAt: '2026-06-02T17:40:23.000Z',
    });

    release();
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('rejects invalid runtime numeric options before doing work', async () => {
    const deps = createMemoryDeps();

    expect(() => new CommandBus(deps, { idempotencyReplayTtlMs: 0 })).toThrow(
      RuntimeOptionError
    );
    await expect(
      runAuditOutboxWorker(deps, { limit: 0 })
    ).rejects.toThrow(RuntimeOptionError);
    await expect(
      rebuildProjection(
        deps,
        {
          name: 'invalid_batch',
          project: () => undefined,
        },
        { batchSize: 0 }
      )
    ).rejects.toThrow(RuntimeOptionError);
  });

  it('rejects non-JSON command idempotency responses', async () => {
    const deps = createMemoryDeps();
    const bus = new CommandBus(deps).register({
      type: 'test.non_json',
      handle: () => ({ invalid: BigInt(1) }),
    });

    await expect(
      bus.dispatch(
        command({
          id: 'cmd_non_json',
          type: 'test.non_json',
          payload: {},
          idempotencyKey: 'idem_non_json',
          occurredAt: deps.clock.now(),
        })
      )
    ).rejects.toThrow(/not serializable|BigInt/);
    await expect(deps.commandIdempotency.get('idem_non_json')).resolves.toMatchObject({
      status: 'failed',
    });
  });

  it('registers default command handlers for existing kernel use cases', async () => {
    const deps = createMemoryDeps();
    const bus = createDefaultCommandBus(deps, {
      resolveActor: () => adminActor,
    });

    expect(bus.listTypes()).toContain(KernelCommandType.WorkCreate);
    expect(bus.listTypes()).toContain(KernelCommandType.PackageRegister);

    await bus.dispatch(
      command({
        id: 'cmd_register_package',
        type: KernelCommandType.PackageRegister,
        payload: {
          name: 'orders',
          version: '1.0.0',
          workflow: sampleOrderWorkflow,
          schema: sampleOrderFieldSchema,
        },
        occurredAt: deps.clock.now(),
      })
    );

    const created = await bus.dispatch<{ id: string; status: string }>(
      command({
        id: 'cmd_create_order',
        type: KernelCommandType.WorkCreate,
        payload: {
          type: 'order',
          fields: { customer: 'Acme', lines: [{ sku: 'A' }] },
        },
        occurredAt: deps.clock.now(),
      })
    );

    const transitioned = await bus.dispatch<{ id: string; status: string }>(
      command({
        id: 'cmd_submit_order',
        type: KernelCommandType.WorkTransition,
        payload: {
          workItemId: created.id,
          action: 'submit',
          expectedVersion: 1,
        },
        occurredAt: deps.clock.now(),
      })
    );

    expect(created.status).toBe('draft');
    expect(transitioned.status).toBe('received');
  });

  it('reports package compatibility and rejects breaking same-major upgrades', () => {
    const current = packageFixture('1.2.0', sampleOrderFieldSchema);
    const next = packageFixture('1.3.0', {
      ...sampleOrderFieldSchema,
      fields: {
        ...sampleOrderFieldSchema.fields,
        customer: { type: 'number', required: true },
      },
    });

    const report = checkPackageCompatibility(current, next);

    expect(report.requiredVersionBump).toBe('major');
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        severity: 'breaking',
        code: 'schema_field_type_changed',
      })
    );
    expect(() => assertPackageUpgradeAllowed(current, next)).toThrow(
      /version does not match compatibility/
    );
  });

  it('reports command and event contract compatibility', () => {
    const from = {
      kind: ContractKind.Command,
      type: 'test.create',
      version: '1.0.0',
      jsonSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
        additionalProperties: false,
      },
    };
    const compatible = {
      ...from,
      version: '1.1.0',
      jsonSchema: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          note: { type: 'string' },
        },
        additionalProperties: false,
      },
    };
    const breaking = {
      ...from,
      version: '2.0.0',
      jsonSchema: {
        type: 'object',
        required: ['id', 'customer'],
        properties: {
          id: { type: 'string' },
          customer: { type: 'string' },
        },
        additionalProperties: false,
      },
    };

    expect(checkContractCompatibility(from, compatible)).toMatchObject({
      status: 'compatible',
      requiredVersionBump: 'minor',
    });
    expect(checkContractCompatibility(from, compatible, { mode: 'full' })).toMatchObject({
      status: 'breaking',
    });
    expect(checkContractCompatibility(from, breaking)).toMatchObject({
      status: 'breaking',
      requiredVersionBump: 'major',
    });
  });

  it('reports package evolution status and migration coverage', () => {
    const current = packageFixture('1.0.0', sampleOrderFieldSchema);
    const next = {
      ...packageFixture('2.0.0', {
        ...sampleOrderFieldSchema,
        fields: {
          ...sampleOrderFieldSchema.fields,
          customer: { type: 'number', required: true },
        },
      }),
      migrations: [
        {
          id: 'orders-2-0-schema',
          kind: 'schema' as const,
          fromVersion: '1.0.0',
          toVersion: '2.0.0',
        },
      ],
    };

    const report = buildPackageEvolutionReport(current, next);

    expect(report.status).toBe('breaking');
    expect(report.migrationRequirements).toEqual([
      { kind: 'schema', required: true, covered: true },
    ]);
  });

  it('persists optional package lifecycle metadata', async () => {
    const deps = createMemoryDeps();
    await registerDomainPackage(deps, {
      name: 'orders',
      version: '1.0.0',
      workflow: sampleOrderWorkflow,
      schema: sampleOrderFieldSchema,
      lifecycle: {
        status: 'replaced',
        note: 'Use orders-v2',
        replacedBy: { name: 'orders-v2', version: '2.0.0' },
      },
      actor: adminActor,
    });

    await expect(deps.packages.getByName('orders')).resolves.toMatchObject({
      lifecycle: {
        status: 'replaced',
        replacedBy: { name: 'orders-v2', version: '2.0.0' },
      },
    });
  });

  it('builds explicit memory kernel dependencies through the adapter helper', async () => {
    const deps = createMemoryKernelDependencies({
      authorizer: new StaticAuthorizer(),
      policyEngine: new AllowAllPolicyEngine(),
      eventPublisher: new NoopEventPublisher(),
      logger: new NoopLogger(),
      tracer: new NoopTracer(),
      clock: new SequenceClock(),
      ids: new SequenceIdGenerator(),
    });

    await registerDomainPackage(deps, {
      name: 'orders',
      version: '1.0.0',
      workflow: sampleOrderWorkflow,
      schema: sampleOrderFieldSchema,
      actor: adminActor,
    });

    await expect(deps.packages.getByName('orders')).resolves.toMatchObject({
      name: 'orders',
      version: '1.0.0',
    });
  });

  it('plans, applies, and records package migrations', async () => {
    const deps = createMemoryDeps();
    await registerDomainPackage(deps, {
      name: 'orders',
      version: '1.0.0',
      workflow: sampleOrderWorkflow,
      schema: sampleOrderFieldSchema,
      actor: adminActor,
    });
    await registerDomainPackage(deps, {
      name: 'orders',
      version: '1.1.0',
      workflow: sampleOrderWorkflow,
      schema: {
        ...sampleOrderFieldSchema,
        fields: {
          ...sampleOrderFieldSchema.fields,
          reference: { type: 'string' },
        },
      },
      migrations: [
        {
          id: 'orders-1-1-reference',
          kind: 'schema',
          fromVersion: '1.0.0',
          toVersion: '1.1.0',
          description: 'Add optional reference',
        },
      ],
      actor: adminActor,
    });

    const dryRun = await runPackageMigrations(deps, {
      packageName: 'orders',
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      dryRun: true,
    });
    expect(dryRun.planned).toHaveLength(1);
    expect(dryRun.applied).toEqual([]);

    let handled = 0;
    const applied = await runPackageMigrations(deps, {
      packageName: 'orders',
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      handlers: {
        schema: () => {
          handled += 1;
        },
      },
    });

    expect(handled).toBe(1);
    expect(applied.applied).toHaveLength(1);
    await expect(
      deps.migrations.get({ packageName: 'orders', migrationId: 'orders-1-1-reference' })
    ).resolves.toMatchObject({ status: 'applied' });
  });

  it('rebuilds projections from audit events', async () => {
    const deps = createMemoryDeps();
    await registerDomainPackage(deps, {
      name: 'orders',
      version: '1.0.0',
      workflow: sampleOrderWorkflow,
      schema: sampleOrderFieldSchema,
      actor: adminActor,
    });
    const created = await createWorkItemUseCase(deps, {
      type: 'order',
      fields: { customer: 'Acme', lines: [{ sku: 'A' }] },
      actor: adminActor,
    });

    const result = await rebuildProjection(deps, {
      name: 'work-item-summary',
      eventTypes: ['WorkItemCreated'],
      project: async ({ event, upsertRecord }) => {
        if (event.type !== 'WorkItemCreated') return;
        await upsertRecord(event.workItemId, () => ({
          id: event.workItemId,
          type: event.workItemType,
          status: event.state,
        }));
      },
    });

    expect(result.processed).toBe(1);
    await expect(
      deps.projections.get({
        projectionName: 'work-item-summary',
        id: created.id,
      })
    ).resolves.toMatchObject({
      value: { id: created.id, type: 'order', status: 'draft' },
    });
    await expect(
      deps.projections.getCheckpoint({ projectionName: 'work-item-summary' })
    ).resolves.toMatchObject({ sequence: 1 });
  });

  it('rebuilds built-in kernel projections from audit events', async () => {
    const deps = createMemoryDeps();
    await registerDomainPackage(deps, {
      name: 'orders',
      version: '1.0.0',
      workflow: sampleOrderWorkflow,
      schema: sampleOrderFieldSchema,
      actor: adminActor,
    });
    const created = await createWorkItemUseCase(deps, {
      type: 'order',
      fields: { customer: 'Acme', lines: [{ sku: 'A' }] },
      actor: adminActor,
    });
    await transitionWorkItemUseCase(deps, {
      workItemId: created.id,
      action: 'submit',
      expectedVersion: 1,
      actor: adminActor,
    });
    await addCommentUseCase(deps, {
      workItemId: created.id,
      text: 'Ready for receiving',
      expectedVersion: 2,
      actor: adminActor,
    });
    await createResourceUseCase(deps, {
      id: 'dock_001',
      type: 'dock',
      fields: { quantity: 2 },
      actor: adminActor,
    });
    await reserveResourceUseCase(deps, {
      workItemId: created.id,
      resourceId: 'dock_001',
      quantity: 1,
      actor: adminActor,
    });
    await releaseResourceReservationUseCase(deps, {
      workItemId: created.id,
      resourceId: 'dock_001',
      quantity: 1,
      actor: adminActor,
    });

    for (const projection of createKernelProjections()) {
      await rebuildProjection(deps, projection);
    }

    await expect(
      deps.projections.get({
        projectionName: KernelProjectionName.WorkItemSummary,
        id: created.id,
      })
    ).resolves.toMatchObject({
      value: {
        id: created.id,
        type: 'order',
        status: 'received',
        commentsCount: 1,
      },
    });
    await expect(
      deps.projections.list({ projectionName: KernelProjectionName.AuditTimeline })
    ).resolves.toHaveLength(6);
    await expect(
      deps.projections.get({
        projectionName: KernelProjectionName.ResourceReservations,
        id: 'dock_001',
      })
    ).resolves.toMatchObject({
      value: {
        id: 'dock_001',
        type: 'dock',
        activeReservations: 0,
        reservedQuantity: 0,
      },
    });
  });

  it('verifies projection drift against a scratch rebuild store', async () => {
    const deps = createMemoryDeps();
    await registerDomainPackage(deps, {
      name: 'orders',
      version: '1.0.0',
      workflow: sampleOrderWorkflow,
      schema: sampleOrderFieldSchema,
      actor: adminActor,
    });
    const created = await createWorkItemUseCase(deps, {
      type: 'order',
      fields: { customer: 'Acme', lines: [{ sku: 'A' }] },
      actor: adminActor,
    });
    const definition = createKernelProjections().find(
      (projection) => projection.name === KernelProjectionName.WorkItemSummary
    )!;

    await rebuildProjection(deps, definition);
    await expect(
      verifyProjection(deps, definition, { scratchStore: new InMemoryProjectionStore() })
    ).resolves.toMatchObject({
      status: 'matched',
      expectedCount: 1,
      actualCount: 1,
      differences: [],
    });

    await deps.projections.save({
      projectionName: KernelProjectionName.WorkItemSummary,
      id: created.id,
      value: { id: created.id, status: 'stale' },
      version: 2,
      updatedAt: deps.clock.now(),
    });

    const drifted = await verifyProjection(deps, definition, {
      scratchStore: new InMemoryProjectionStore(),
    });
    expect(drifted.status).toBe('drifted');
    expect(drifted.differences).toContainEqual(
      expect.objectContaining({ kind: 'changed', id: created.id })
    );
  });

  it('compares projection records without requiring a rebuild', () => {
    const compared = compareProjectionRecords({
      projectionName: 'test',
      expected: [
        {
          projectionName: 'test',
          id: 'one',
          value: { count: 1 },
          version: 1,
          updatedAt: '2026-06-04T12:00:00.000Z',
        },
      ],
      actual: [
        {
          projectionName: 'test',
          id: 'one',
          value: { count: 2 },
          version: 1,
          updatedAt: '2026-06-04T12:00:00.000Z',
        },
      ],
    });

    expect(compared).toMatchObject({
      status: 'drifted',
      differences: [{ kind: 'changed', id: 'one' }],
    });
  });
});

function packageFixture(version: string, schema: FieldSchema): DomainPackage {
  return {
    name: 'orders',
    version,
    workflowType: 'order',
    workflow: normalizeWorkflow(),
    schema,
    migrations: [],
    fixtures: [],
    registeredAt: '2026-06-04T12:00:00.000Z',
  };
}

function normalizeWorkflow(): NormalizedWorkflowDefinition {
  return {
    type: 'order',
    initialState: 'draft',
    states: ['draft', 'received', 'validated', 'released', 'closed'],
    transitions: sampleOrderWorkflow.transitions,
    closedStates: ['closed'],
  };
}
