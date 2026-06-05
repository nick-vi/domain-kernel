import type { DomainPackage } from '@/domain/package/domain-package';
import type { DomainPackageRepository } from '@/ports/domain-package';
import { compareVersions } from '@/primitives/migration';
import { compareStrings } from '@/primitives/string';

export class InMemoryDomainPackageRepository implements DomainPackageRepository {
  private readonly packages = new Map<string, DomainPackage>();

  async save(domainPackage: DomainPackage): Promise<void> {
    this.packages.set(
      packageKey(domainPackage.name, domainPackage.version),
      structuredClone(domainPackage)
    );
  }

  async getByName(name: string): Promise<DomainPackage | null> {
    const domainPackage = latestPackage(
      [...this.packages.values()].filter((item) => item.name === name)
    );
    return domainPackage == null ? null : structuredClone(domainPackage);
  }

  async getByNameAndVersion(name: string, version: string): Promise<DomainPackage | null> {
    const domainPackage = this.packages.get(packageKey(name, version));
    return domainPackage == null ? null : structuredClone(domainPackage);
  }

  async getByWorkflowType(workflowType: string): Promise<DomainPackage | null> {
    const domainPackage = latestPackage(
      [...this.packages.values()].filter((item) => item.workflowType === workflowType)
    );
    return domainPackage == null ? null : structuredClone(domainPackage);
  }

  async listVersions(name: string): Promise<DomainPackage[]> {
    return sortPackages([...this.packages.values()].filter((item) => item.name === name)).map((item) =>
      structuredClone(item)
    );
  }

  async list(): Promise<DomainPackage[]> {
    return sortPackages([...this.packages.values()]).map((domainPackage) =>
      structuredClone(domainPackage)
    );
  }
}

function packageKey(name: string, version: string): string {
  return `${name}@${version}`;
}

function latestPackage(packages: DomainPackage[]): DomainPackage | undefined {
  return sortPackages(packages).at(-1);
}

function sortPackages(packages: DomainPackage[]): DomainPackage[] {
  return packages.sort((left, right) => {
    const name = compareStrings(left.name, right.name);
    if (name !== 0) return name;
    return (
      compareVersions(left.version, right.version).unwrapOr(0) ||
      compareStrings(left.registeredAt, right.registeredAt)
    );
  });
}
