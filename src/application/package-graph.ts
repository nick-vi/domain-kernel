import type {
  DomainPackage,
  PackageCapability,
  PackageDependency,
} from '@/domain/package/domain-package';
import { compareVersions } from '@/primitives/migration';
import { compareStrings } from '@/primitives/string';

export type PackageGraphNode = {
  name: string;
  version: string;
  workflowType: string;
  dependencies: PackageDependency[];
  capabilities: PackageCapability[];
};

export type PackageGraphEdge = {
  from: string;
  to: string;
  version?: string | undefined;
};

export type PackageGraph = {
  nodes: PackageGraphNode[];
  edges: PackageGraphEdge[];
  missing: PackageGraphEdge[];
  cycles: string[][];
  installOrder: string[];
};

export function buildPackageGraph(packages: readonly DomainPackage[]): PackageGraph {
  const latestByName = latestPackages(packages);
  const nodes = [...latestByName.values()]
    .map((domainPackage) => ({
      name: domainPackage.name,
      version: domainPackage.version,
      workflowType: domainPackage.workflowType,
      dependencies: [...(domainPackage.dependencies ?? [])].sort((left, right) =>
        compareStrings(left.name, right.name)
      ),
      capabilities: [...(domainPackage.capabilities ?? [])].sort((left, right) =>
        compareStrings(left.kind, right.kind) || compareStrings(left.name, right.name)
      ),
    }))
    .sort((left, right) => compareStrings(left.name, right.name));

  const edges: PackageGraphEdge[] = [];
  const missing: PackageGraphEdge[] = [];
  for (const node of nodes) {
    for (const dependency of node.dependencies) {
      const edge = {
        from: node.name,
        to: dependency.name,
        ...(dependency.version != null ? { version: dependency.version } : {}),
      };
      if (latestByName.has(dependency.name)) edges.push(edge);
      else missing.push(edge);
    }
  }

  return {
    nodes,
    edges: edges.sort(compareEdges),
    missing: missing.sort(compareEdges),
    cycles: findCycles(nodes, edges),
    installOrder: topologicalOrder(nodes, edges),
  };
}

function latestPackages(packages: readonly DomainPackage[]): Map<string, DomainPackage> {
  const latest = new Map<string, DomainPackage>();
  for (const domainPackage of packages) {
    const current = latest.get(domainPackage.name);
    if (
      current == null ||
      compareVersions(current.version, domainPackage.version).unwrapOr(
        compareStrings(current.version, domainPackage.version)
      ) < 0 ||
      (current.version === domainPackage.version &&
        compareStrings(current.registeredAt, domainPackage.registeredAt) < 0)
    ) {
      latest.set(domainPackage.name, domainPackage);
    }
  }
  return latest;
}

function topologicalOrder(nodes: PackageGraphNode[], edges: PackageGraphEdge[]): string[] {
  const nodeNames = new Set(nodes.map((node) => node.name));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];
  const outgoing = edgesBySource(edges);

  const visit = (name: string) => {
    if (visited.has(name) || visiting.has(name)) return;
    visiting.add(name);
    for (const edge of outgoing.get(name) ?? []) {
      if (nodeNames.has(edge.to)) visit(edge.to);
    }
    visiting.delete(name);
    visited.add(name);
    order.push(name);
  };

  for (const node of nodes) visit(node.name);
  return order;
}

function findCycles(nodes: PackageGraphNode[], edges: PackageGraphEdge[]): string[][] {
  const cycles: string[][] = [];
  const outgoing = edgesBySource(edges);

  const visit = (name: string, path: string[]) => {
    const existingIndex = path.indexOf(name);
    if (existingIndex >= 0) {
      cycles.push(path.slice(existingIndex));
      return;
    }

    for (const edge of outgoing.get(name) ?? []) {
      visit(edge.to, [...path, name]);
    }
  };

  for (const node of nodes) visit(node.name, []);
  return uniqueCycles(cycles);
}

function edgesBySource(edges: PackageGraphEdge[]): Map<string, PackageGraphEdge[]> {
  const map = new Map<string, PackageGraphEdge[]>();
  for (const edge of edges) {
    map.set(edge.from, [...(map.get(edge.from) ?? []), edge]);
  }
  return map;
}

function uniqueCycles(cycles: string[][]): string[][] {
  const seen = new Set<string>();
  const unique: string[][] = [];
  for (const cycle of cycles) {
    const key = [...cycle].sort(compareStrings).join('>');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(cycle);
  }
  return unique;
}

function compareEdges(left: PackageGraphEdge, right: PackageGraphEdge): number {
  return compareStrings(left.from, right.from) || compareStrings(left.to, right.to);
}
