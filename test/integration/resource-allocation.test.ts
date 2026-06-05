import { describe, expect, it } from 'vitest';
import { createResourceUseCase } from '@/application/use-cases';
import { createWorkItemUseCase } from '@/application/use-cases';
import { listResourcesUseCase } from '@/application/use-cases';
import { queryAuditEventsUseCase } from '@/application/use-cases';
import { registerDomainPackage } from '@/application/use-cases';
import { releaseResourceReservationUseCase } from '@/application/use-cases';
import { reserveResourceUseCase } from '@/application/use-cases';
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
import type { ApplicationDependencies } from '@/application/dependencies';

const unauthorizedActor = { id: 'blocked', roles: ['blocked'] };

describe('resource model and reservation ports', () => {
  it('creates a resource', async () => {
    const deps = createMemoryDeps();

    const resource = await createResourceUseCase(deps, {
      id: 'stock:sku_123',
      type: 'stock',
      fields: { quantity: 100, zone: 'frozen' },
      actor: adminActor,
    });

    expect(resource).toMatchObject({
      id: 'stock:sku_123',
      type: 'stock',
      fields: { quantity: 100, zone: 'frozen' },
      version: 1,
    });
  });

  it('lists resources by type', async () => {
    const deps = createMemoryDeps();
    await createResourceUseCase(deps, {
      id: 'stock:sku_123',
      type: 'stock',
      actor: adminActor,
    });
    await createResourceUseCase(deps, {
      id: 'vehicle:van_1',
      type: 'vehicle',
      actor: adminActor,
    });

    const resources = await listResourcesUseCase(deps, viewerActor, { type: 'stock' });

    expect(resources.map((resource) => resource.id)).toEqual(['stock:sku_123']);
  });

  it('reserves a resource for a work item', async () => {
    const deps = createMemoryDeps();
    const { workItem } = await seedResourceFixture(deps);

    const reservation = await reserveResourceUseCase(deps, {
      workItemId: workItem.id,
      resourceId: 'stock:sku_123',
      quantity: 10,
      actor: operatorActor,
    });

    expect(reservation).toMatchObject({
      id: 'resv_001',
      resourceId: 'stock:sku_123',
      resourceType: 'stock',
      workItemId: workItem.id,
      quantity: 10,
      status: 'active',
    });
  });

  it('rejects reservations that exceed resource quantity capacity', async () => {
    const deps = createMemoryDeps();
    const { workItem } = await seedResourceFixture(deps);
    await reserveResourceUseCase(deps, {
      workItemId: workItem.id,
      resourceId: 'stock:sku_123',
      quantity: 95,
      actor: operatorActor,
    });

    await expect(
      reserveResourceUseCase(deps, {
        workItemId: workItem.id,
        resourceId: 'stock:sku_123',
        quantity: 10,
        actor: operatorActor,
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        code: 'capacity_exceeded',
        resourceId: 'stock:sku_123',
      },
    });
  });

  it('releases a reservation', async () => {
    const deps = createMemoryDeps();
    const { workItem } = await seedResourceFixture(deps);
    await reserveResourceUseCase(deps, {
      workItemId: workItem.id,
      resourceId: 'stock:sku_123',
      quantity: 10,
      actor: operatorActor,
    });

    const released = await releaseResourceReservationUseCase(deps, {
      workItemId: workItem.id,
      resourceId: 'stock:sku_123',
      quantity: 10,
      actor: operatorActor,
    });

    expect(released).toMatchObject({
      id: 'resv_001',
      status: 'released',
      releasedAt: '2026-06-02T17:44:22.000Z',
    });
  });

  it('rejects unauthorized reserve and emits no audit event', async () => {
    const deps = createMemoryDeps();
    const { workItem } = await seedResourceFixture(deps);

    await expect(
      reserveResourceUseCase(deps, {
        workItemId: workItem.id,
        resourceId: 'stock:sku_123',
        quantity: 10,
        actor: viewerActor,
      })
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      details: { permission: 'resource:reserve' },
    });

    const reservations = await deps.resourceReservations.list();
    const events = await queryAuditEventsUseCase(deps, {
      actor: viewerActor,
      query: { type: 'ResourceReserved' },
    });

    expect(reservations).toHaveLength(0);
    expect(events.events).toHaveLength(0);
  });

  it('rejects resource access for actors without resource permissions', async () => {
    const deps = createMemoryDeps();

    await expect(
      createResourceUseCase(deps, {
        id: 'stock:sku_123',
        type: 'stock',
        actor: unauthorizedActor,
      })
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      details: { permission: 'resource:create' },
    });
  });

  it('persists resources and reservations across filesystem reload', async () => {
    const dataDir = await createTempDir();
    try {
      const deps = createFsDeps(dataDir);
      const { workItem } = await seedResourceFixture(deps);
      await reserveResourceUseCase(deps, {
        workItemId: workItem.id,
        resourceId: 'stock:sku_123',
        quantity: 10,
        actor: operatorActor,
      });

      const restarted = createFsDeps(dataDir);
      const resources = await restarted.resources.list({ type: 'stock' });
      const reservations = await restarted.resourceReservations.list({
        resourceId: 'stock:sku_123',
      });

      expect(resources.map((resource) => resource.id)).toEqual(['stock:sku_123']);
      expect(reservations).toEqual([
        expect.objectContaining({
          resourceId: 'stock:sku_123',
          workItemId: workItem.id,
          quantity: 10,
          status: 'active',
        }),
      ]);
    } finally {
      await removeTempDir(dataDir);
    }
  });

  it('enforces resource quantity capacity inside filesystem reservations', async () => {
    const dataDir = await createTempDir();
    try {
      const deps = createFsDeps(dataDir);
      const resource = await createResourceUseCase(deps, {
        id: 'stock:sku_123',
        type: 'stock',
        fields: { quantity: 100 },
        actor: adminActor,
      });

      const results = await Promise.allSettled([
        deps.resourceReservations.reserve({
          id: 'resv_a',
          resource,
          workItemId: 'work_a',
          quantity: 60,
          occurredAt: '2026-06-02T17:40:22.000Z',
        }),
        deps.resourceReservations.reserve({
          id: 'resv_b',
          resource,
          workItemId: 'work_b',
          quantity: 60,
          occurredAt: '2026-06-02T17:40:23.000Z',
        }),
      ]);
      const active = await deps.resourceReservations.list({
        resourceId: resource.id,
        status: 'active',
      });

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(active).toHaveLength(1);
      expect(active[0]?.quantity).toBe(60);
    } finally {
      await removeTempDir(dataDir);
    }
  });

  it('enforces resource quantity capacity inside memory reservations', async () => {
    const deps = createMemoryDeps();
    const resource = await createResourceUseCase(deps, {
      id: 'stock:sku_123',
      type: 'stock',
      fields: { quantity: 100 },
      actor: adminActor,
    });

    const results = await Promise.allSettled([
      deps.resourceReservations.reserve({
        id: 'resv_a',
        resource,
        workItemId: 'work_a',
        quantity: 60,
        occurredAt: '2026-06-02T17:40:22.000Z',
      }),
      deps.resourceReservations.reserve({
        id: 'resv_b',
        resource,
        workItemId: 'work_b',
        quantity: 60,
        occurredAt: '2026-06-02T17:40:23.000Z',
      }),
    ]);
    const active = await deps.resourceReservations.list({
      resourceId: resource.id,
      status: 'active',
    });

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(active).toHaveLength(1);
    expect(active[0]?.quantity).toBe(60);
  });

  it('queries resource audit events by event type', async () => {
    const deps = createMemoryDeps();
    const { workItem } = await seedResourceFixture(deps);
    await reserveResourceUseCase(deps, {
      workItemId: workItem.id,
      resourceId: 'stock:sku_123',
      quantity: 10,
      actor: operatorActor,
    });
    await releaseResourceReservationUseCase(deps, {
      workItemId: workItem.id,
      resourceId: 'stock:sku_123',
      quantity: 10,
      actor: operatorActor,
    });

    const created = await queryAuditEventsUseCase(deps, {
      actor: viewerActor,
      query: { type: 'ResourceCreated' },
    });
    const reserved = await queryAuditEventsUseCase(deps, {
      actor: viewerActor,
      query: { type: 'ResourceReserved' },
    });
    const released = await queryAuditEventsUseCase(deps, {
      actor: viewerActor,
      query: { type: 'ResourceReservationReleased' },
    });

    expect(created.events).toEqual([
      expect.objectContaining({
        type: 'ResourceCreated',
        resourceId: 'stock:sku_123',
        resourceType: 'stock',
      }),
    ]);
    expect(reserved.events).toEqual([
      expect.objectContaining({
        type: 'ResourceReserved',
        resourceId: 'stock:sku_123',
        workItemId: workItem.id,
        quantity: 10,
      }),
    ]);
    expect(released.events).toEqual([
      expect.objectContaining({
        type: 'ResourceReservationReleased',
        resourceId: 'stock:sku_123',
        workItemId: workItem.id,
        quantity: 10,
      }),
    ]);
  });
});

async function seedResourceFixture(deps: ApplicationDependencies) {
  await registerDomainPackage(deps, {
    name: 'sample-orders',
    workflow: sampleOrderWorkflow,
    schema: sampleOrderFieldSchema,
    actor: adminActor,
  });
  const workItem = await createWorkItemUseCase(deps, {
    type: 'order',
    fields: {
      customer: 'acme',
      priority: 'normal',
      lines: [{ sku: 'frozen-peas', quantity: 12 }],
    },
    actor: operatorActor,
  });
  const resource = await createResourceUseCase(deps, {
    id: 'stock:sku_123',
    type: 'stock',
    fields: { quantity: 100 },
    actor: adminActor,
  });

  return { workItem, resource };
}
