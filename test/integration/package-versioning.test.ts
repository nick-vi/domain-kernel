import { describe, expect, it } from 'vitest';
import { registerDomainPackage } from '@/application/use-cases';
import {
  adminActor,
  createMemoryDeps,
  sampleOrderFieldSchema,
  sampleOrderWorkflow,
} from '../support/application';

describe('domain package versioning', () => {
  it('registers immutable package versions and returns the latest version by name', async () => {
    const deps = createMemoryDeps();
    await registerDomainPackage(deps, {
      name: 'sample-orders',
      version: '1.0.0',
      workflow: sampleOrderWorkflow,
      schema: sampleOrderFieldSchema,
      actor: adminActor,
    });
    await registerDomainPackage(deps, {
      name: 'sample-orders',
      version: '1.1.0',
      workflow: sampleOrderWorkflow,
      schema: {
        ...sampleOrderFieldSchema,
        fields: {
          ...sampleOrderFieldSchema.fields,
          reference: { type: 'string' },
        },
      },
      migrations: [{ id: '001', kind: 'schema', fromVersion: '1.0.0', toVersion: '1.1.0' }],
      actor: adminActor,
    });

    await expect(deps.packages.listVersions('sample-orders')).resolves.toHaveLength(2);
    await expect(deps.packages.getByName('sample-orders')).resolves.toMatchObject({
      version: '1.1.0',
      migrations: [expect.objectContaining({ id: '001' })],
    });
  });

  it('rejects registering the same package version with different content', async () => {
    const deps = createMemoryDeps();
    await registerDomainPackage(deps, {
      name: 'sample-orders',
      version: '1.0.0',
      workflow: sampleOrderWorkflow,
      schema: sampleOrderFieldSchema,
      actor: adminActor,
    });

    await expect(
      registerDomainPackage(deps, {
        name: 'sample-orders',
        version: '1.0.0',
        workflow: sampleOrderWorkflow,
        schema: {
          ...sampleOrderFieldSchema,
          fields: {
            ...sampleOrderFieldSchema.fields,
            reference: { type: 'string' },
          },
        },
        actor: adminActor,
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        packageName: 'sample-orders',
        version: '1.0.0',
      },
    });
  });
});
