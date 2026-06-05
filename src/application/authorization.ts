import type { Actor, Permission } from '@/domain/auth/auth';
import { UnauthorizedError } from '@/domain/errors/domain-error';
import type { ApplicationDependencies } from './dependencies';

export function authorize(
  deps: ApplicationDependencies,
  actor: Actor,
  permission: Permission
): void {
  const decision = deps.authorizer.authorize(actor, permission);
  if (!decision.allowed) {
    throw new UnauthorizedError(decision.reason, {
      actorId: actor.id,
      roles: actor.roles,
      permission,
      code: decision.code,
    });
  }
}
