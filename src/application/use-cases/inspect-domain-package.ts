import { NotFoundError } from '@/domain/errors/domain-error';
import type { Actor } from '@/domain/auth/auth';
import type { DomainPackage } from '@/domain/package/domain-package';
import type { ApplicationDependencies } from '@/application/dependencies';
import { authorize } from '@/application/authorization';

export type InspectDomainPackageInput = {
  name: string;
  actor: Actor;
};

export async function inspectDomainPackage(
  deps: ApplicationDependencies,
  input: InspectDomainPackageInput
): Promise<DomainPackage> {
  return deps.tracer.span('inspectDomainPackage', { name: input.name }, async () => {
    authorize(deps, input.actor, 'package:inspect');
    const domainPackage = await deps.packages.getByName(input.name);
    if (domainPackage == null) {
      throw new NotFoundError(`Domain package "${input.name}" was not found`, {
        packageName: input.name,
      });
    }
    return domainPackage;
  });
}
