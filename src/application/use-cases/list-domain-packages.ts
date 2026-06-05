import type { Actor } from '@/domain/auth/auth';
import type { DomainPackage } from '@/domain/package/domain-package';
import type { ApplicationDependencies } from '@/application/dependencies';
import { authorize } from '@/application/authorization';

export async function listDomainPackages(
  deps: ApplicationDependencies,
  actor: Actor
): Promise<DomainPackage[]> {
  return deps.tracer.span('listDomainPackages', {}, async () => {
    authorize(deps, actor, 'package:list');
    return deps.packages.list();
  });
}
