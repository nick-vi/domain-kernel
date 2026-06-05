import { describe, expect, it } from 'vitest';
import { buildPackageGraph } from '@/application';
import type { DomainPackage } from '@/domain/package/domain-package';
import { normalizeWorkflowDefinition } from '@/domain/workflow/workflow-definition';

describe('buildPackageGraph', () => {
  it('orders dependencies, reports missing packages, and exposes capabilities', () => {
    const graph = buildPackageGraph([
      packageFor('orders', {
        dependencies: [{ name: 'products' }, { name: 'pricing' }],
        capabilities: [{ name: 'order.workflow', kind: 'workflow' }],
      }),
      packageFor('products', {
        capabilities: [{ name: 'product.schema', kind: 'schema' }],
      }),
    ]);

    expect(graph.installOrder).toEqual(['products', 'orders']);
    expect(graph.edges).toEqual([{ from: 'orders', to: 'products' }]);
    expect(graph.missing).toEqual([{ from: 'orders', to: 'pricing' }]);
    expect(graph.nodes.find((node) => node.name === 'orders')?.capabilities).toEqual([
      { name: 'order.workflow', kind: 'workflow' },
    ]);
  });

  it('detects dependency cycles', () => {
    const graph = buildPackageGraph([
      packageFor('a', { dependencies: [{ name: 'b' }] }),
      packageFor('b', { dependencies: [{ name: 'a' }] }),
    ]);

    expect(graph.cycles).toHaveLength(1);
    expect(graph.cycles[0]?.sort()).toEqual(['a', 'b']);
  });
});

function packageFor(
  name: string,
  input: Pick<DomainPackage, 'dependencies' | 'capabilities'>
): DomainPackage {
  const workflow = normalizeWorkflowDefinition({
    type: name,
    states: ['draft'],
    transitions: [],
  });
  return {
    name,
    version: '1.0.0',
    workflowType: name,
    workflow,
    schema: { type: name, fields: {} },
    migrations: [],
    fixtures: [],
    dependencies: input.dependencies,
    capabilities: input.capabilities,
    registeredAt: '2026-06-04T12:00:00.000Z',
  };
}
