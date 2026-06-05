import type { DomainPackage } from '@/domain/package/domain-package';

export interface DomainPackageRepository {
  save(domainPackage: DomainPackage): Promise<void>;
  getByName(name: string): Promise<DomainPackage | null>;
  getByNameAndVersion(name: string, version: string): Promise<DomainPackage | null>;
  getByWorkflowType(workflowType: string): Promise<DomainPackage | null>;
  listVersions(name: string): Promise<DomainPackage[]>;
  list(): Promise<DomainPackage[]>;
}
