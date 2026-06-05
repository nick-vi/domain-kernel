import type { DomainPackage } from '@/domain/package/domain-package';
import type { DomainPackageRepository } from '@/ports/domain-package';
import { compareVersions } from '@/primitives/migration';
import { compareStrings } from '@/primitives/string';
import { DomainPackageSchema } from '@/validation/schemas';
import {
  filenameForId,
  listFilesRecursive,
  pathExists,
  readJson,
  safeJoin,
  type FileTempNames,
  writeJsonAtomic,
} from './fs-utils';

export class FsDomainPackageRepository implements DomainPackageRepository {
  private readonly root: string;

  constructor(dataDir: string, private readonly tempNames: FileTempNames) {
    this.root = safeJoin(dataDir, 'packages');
  }

  async save(domainPackage: DomainPackage): Promise<void> {
    await writeJsonAtomic(
      this.pathFor(domainPackage.name, domainPackage.version),
      domainPackage,
      this.tempNames
    );
  }

  async getByName(name: string): Promise<DomainPackage | null> {
    const domainPackage = latestPackage((await this.list()).filter((item) => item.name === name));
    return domainPackage ?? null;
  }

  async getByNameAndVersion(name: string, version: string): Promise<DomainPackage | null> {
    const path = this.pathFor(name, version);
    if (!(await pathExists(path))) {
      return null;
    }
    return readJson<DomainPackage>(path, DomainPackageSchema);
  }

  async getByWorkflowType(workflowType: string): Promise<DomainPackage | null> {
    return latestPackage((await this.list()).filter((item) => item.workflowType === workflowType)) ?? null;
  }

  async listVersions(name: string): Promise<DomainPackage[]> {
    return sortPackages((await this.list()).filter((item) => item.name === name));
  }

  async list(): Promise<DomainPackage[]> {
    const files = await listFilesRecursive(this.root);
    const packages = await Promise.all(
      files.map((file) => readJson<DomainPackage>(file, DomainPackageSchema))
    );
    return sortPackages(packages);
  }

  private pathFor(name: string, version: string): string {
    return safeJoin(this.root, filenameForId(`${name}@${version}`));
  }
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
