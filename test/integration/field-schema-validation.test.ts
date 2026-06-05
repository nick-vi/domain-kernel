import { describe, expect, it } from 'vitest';
import { createWorkItemUseCase } from '@/application/use-cases';
import { getHistoryUseCase } from '@/application/use-cases';
import { registerDomainPackage } from '@/application/use-cases';
import { registerWorkflow } from '@/application/use-cases';
import { transitionWorkItemUseCase } from '@/application/use-cases';
import { updateWorkItemFieldsUseCase } from '@/application/use-cases';
import {
  adminActor,
  createFsDeps,
  createMemoryDeps,
  createTempDir,
  operatorActor,
  removeTempDir,
  sampleOrderFieldSchema,
  sampleOrderWorkflow,
  viewerActor,
} from '../support/application';

describe('package field schema validation', () => {
  it('rejects missing schema-required fields on create', async () => {
    const deps = createMemoryDeps();
    await registerSamplePackage(deps);

    await expect(
      createWorkItemUseCase(deps, {
        type: 'order',
        fields: { priority: 'high' },
        actor: operatorActor,
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        source: 'createWorkItem',
        issues: [
          expect.objectContaining({ field: 'customer', code: 'missing_required' }),
          expect.objectContaining({ field: 'lines', code: 'missing_required' }),
        ],
      },
    });
  });

  it('rejects invalid field types on create', async () => {
    const deps = createMemoryDeps();
    await registerSamplePackage(deps);

    await expect(
      createWorkItemUseCase(deps, {
        type: 'order',
        fields: { customer: 123, lines: [{ sku: 'peas', quantity: 12 }] },
        actor: operatorActor,
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        source: 'createWorkItem',
        issues: [expect.objectContaining({ field: 'customer', code: 'invalid_type' })],
      },
    });
  });

  it('uses explicit minLength for present but empty required strings', async () => {
    const deps = createMemoryDeps();
    await registerSamplePackage(deps);

    await expect(
      createWorkItemUseCase(deps, {
        type: 'order',
        fields: { customer: '', lines: [{ sku: 'peas', quantity: 12 }] },
        actor: operatorActor,
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        source: 'createWorkItem',
        issues: [expect.objectContaining({ field: 'customer', code: 'invalid_string' })],
      },
    });
  });

  it('rejects invalid enum values on create', async () => {
    const deps = createMemoryDeps();
    await registerSamplePackage(deps);

    await expect(
      createWorkItemUseCase(deps, {
        type: 'order',
        fields: {
          customer: 'acme',
          priority: 'urgent',
          lines: [{ sku: 'peas', quantity: 12 }],
        },
        actor: operatorActor,
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        source: 'createWorkItem',
        issues: [expect.objectContaining({ field: 'priority', code: 'invalid_enum_value' })],
      },
    });
  });

  it('rejects required transition fields that are present but fail schema validation', async () => {
    const deps = createMemoryDeps();
    await registerWorkflow(deps, { workflow: sampleOrderWorkflow, actor: adminActor });
    const legacyOrder = await createWorkItemUseCase(deps, {
      type: 'order',
      fields: { customer: 'acme', lines: 'not-an-array' },
      actor: operatorActor,
    });
    await registerSamplePackage(deps);

    await expect(
      transitionWorkItemUseCase(deps, {
        workItemId: legacyOrder.id,
        action: 'submit',
        actor: operatorActor,
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        source: 'transitionWorkItem',
        issues: [expect.objectContaining({ field: 'lines', code: 'invalid_type' })],
      },
    });
  });

  it('rejects unknown field updates by default', async () => {
    const deps = createMemoryDeps();
    await registerSamplePackage(deps);
    const order = await createValidOrder(deps);

    await expect(
      updateWorkItemFieldsUseCase(deps, {
        workItemId: order.id,
        fields: { unknownField: 'nope' },
        actor: operatorActor,
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        source: 'updateWorkItemFields',
        issues: [expect.objectContaining({ field: 'unknownField', code: 'unknown_field' })],
      },
    });
  });

  it('allows unknown field updates when a package schema opts into extras', async () => {
    const deps = createMemoryDeps();
    await registerDomainPackage(deps, {
      name: 'loose-orders',
      workflow: sampleOrderWorkflow,
      schema: { ...sampleOrderFieldSchema, allowAdditionalFields: true },
      actor: adminActor,
    });
    const order = await createValidOrder(deps);

    const updated = await updateWorkItemFieldsUseCase(deps, {
      workItemId: order.id,
      fields: { externalReference: 'ext_123' },
      actor: operatorActor,
    });

    expect(updated.fields.externalReference).toBe('ext_123');
  });

  it('emits a WorkItemFieldsUpdated audit event for field updates', async () => {
    const deps = createMemoryDeps();
    await registerSamplePackage(deps);
    const order = await createValidOrder(deps);

    await updateWorkItemFieldsUseCase(deps, {
      workItemId: order.id,
      fields: { priority: 'high', requiresReview: true },
      actor: operatorActor,
    });
    const history = await getHistoryUseCase(deps, { workItemId: order.id, actor: viewerActor });

    expect(history.map((event) => event.type)).toEqual([
      'WorkItemCreated',
      'WorkItemFieldsUpdated',
    ]);
    expect(history[1]).toMatchObject({
      type: 'WorkItemFieldsUpdated',
      fields: { priority: 'high', requiresReview: true },
      previousFields: { priority: 'normal' },
      actorId: 'operator',
    });
  });

  it('emits no audit event when a field update is unauthorized', async () => {
    const deps = createMemoryDeps();
    await registerSamplePackage(deps);
    const order = await createValidOrder(deps);

    await expect(
      updateWorkItemFieldsUseCase(deps, {
        workItemId: order.id,
        fields: { priority: 'high' },
        actor: viewerActor,
      })
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      details: { permission: 'work:update' },
    });

    const reloaded = await deps.workItems.getById(order.id);
    const history = await getHistoryUseCase(deps, { workItemId: order.id, actor: viewerActor });

    expect(reloaded?.fields.priority).toBe('normal');
    expect(history.map((event) => event.type)).toEqual(['WorkItemCreated']);
  });

  it('preserves validated field values exactly after filesystem reload', async () => {
    const dataDir = await createTempDir();
    try {
      const deps = createFsDeps(dataDir);
      await registerSamplePackage(deps);
      const order = await createValidOrder(deps);
      await updateWorkItemFieldsUseCase(deps, {
        workItemId: order.id,
        fields: {
          priority: 'high',
          requiresReview: true,
          lines: [{ sku: 'frozen-peas', quantity: 12, substitutionsAllowed: false }],
        },
        actor: operatorActor,
      });

      const restarted = createFsDeps(dataDir);
      const reloaded = await restarted.workItems.getById(order.id);

      expect(reloaded?.fields).toEqual({
        customer: 'acme',
        priority: 'high',
        requiresReview: true,
        lines: [{ sku: 'frozen-peas', quantity: 12, substitutionsAllowed: false }],
      });
    } finally {
      await removeTempDir(dataDir);
    }
  });
});

async function registerSamplePackage(deps: ReturnType<typeof createMemoryDeps>): Promise<void> {
  await registerDomainPackage(deps, {
    name: 'sample-orders',
    workflow: sampleOrderWorkflow,
    schema: sampleOrderFieldSchema,
    actor: adminActor,
  });
}

async function createValidOrder(deps: ReturnType<typeof createMemoryDeps>) {
  return createWorkItemUseCase(deps, {
    type: 'order',
    fields: {
      customer: 'acme',
      priority: 'normal',
      lines: [{ sku: 'frozen-peas', quantity: 12 }],
    },
    actor: operatorActor,
  });
}
