import { describe, expect, it } from 'vitest';
import { testDomainPackage } from '@/application';
import {
  adminActor,
  createMemoryDeps,
  sampleOrderFieldSchema,
  sampleOrderWorkflow,
} from '../../support/application';

describe('testDomainPackage', () => {
  it('validates fixtures and can register through application dependencies', async () => {
    const deps = createMemoryDeps();

    const result = await testDomainPackage(deps, {
      name: 'orders',
      version: '1.0.0',
      workflow: sampleOrderWorkflow,
      schema: sampleOrderFieldSchema,
      fixtures: [
        {
          name: 'basic-order',
          fields: {
            customer: 'Acme',
            lines: [{ sku: 'sku_001', quantity: 1 }],
            priority: 'normal',
          },
        },
      ],
      actor: adminActor,
      register: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      packageName: 'orders',
      version: '1.0.0',
      workflowType: 'order',
      fixtureCount: 1,
      registered: true,
    });
    await expect(deps.packages.getByName('orders')).resolves.toMatchObject({
      version: '1.0.0',
    });
  });

  it('returns Err for invalid fixtures', async () => {
    const result = await testDomainPackage(createMemoryDeps(), {
      name: 'orders',
      workflow: sampleOrderWorkflow,
      schema: sampleOrderFieldSchema,
      fixtures: [
        {
          name: 'missing-required',
          fields: { priority: 'normal' },
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('Work item fields do not match package schema');
  });
});
