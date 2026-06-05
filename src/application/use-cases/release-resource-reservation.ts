import { authorize } from '@/application/authorization';
import { recordAuditEvent } from '@/application/audit';
import type { ApplicationDependencies } from '@/application/dependencies';
import type { Actor } from '@/domain/auth/auth';
import type { ResourceReservationReleasedEvent } from '@/domain/event/audit-event';
import { NotFoundError } from '@/domain/errors/domain-error';
import type { ResourceReservation } from '@/domain/resource/resource';

export type ReleaseResourceReservationInput = {
  workItemId: string;
  resourceId: string;
  quantity?: number | undefined;
  actor: Actor;
};

export async function releaseResourceReservationUseCase(
  deps: ApplicationDependencies,
  input: ReleaseResourceReservationInput
): Promise<ResourceReservation> {
  return deps.tracer.span(
    'releaseResourceReservation',
    { workItemId: input.workItemId, resourceId: input.resourceId },
    async () => {
      authorize(deps, input.actor, 'resource:release');
      const workItem = await deps.workItems.getById(input.workItemId);
      if (workItem == null) {
        throw new NotFoundError(`Work item "${input.workItemId}" was not found`, {
          workItemId: input.workItemId,
        });
      }

      const resource = await deps.resources.getById(input.resourceId);
      if (resource == null) {
        throw new NotFoundError(`Resource "${input.resourceId}" was not found`, {
          resourceId: input.resourceId,
        });
      }

      const result = await deps.unitOfWork.run(async () => {
        const occurredAt = deps.clock.now();
        const releaseResult = await deps.resourceReservations.release({
          resourceId: input.resourceId,
          workItemId: input.workItemId,
          quantity: input.quantity,
          occurredAt,
        });

        const event: ResourceReservationReleasedEvent = {
          id: deps.ids.nextId('evt'),
          type: 'ResourceReservationReleased',
          workItemId: input.workItemId,
          resourceId: resource.id,
          resourceType: resource.type,
          reservationId: releaseResult.reservation.id,
          ...(releaseResult.reservation.quantity != null
            ? { quantity: releaseResult.reservation.quantity }
            : {}),
          actorId: input.actor.id,
          occurredAt,
        };

        await recordAuditEvent(deps, event);
        return releaseResult;
      }, { name: 'releaseResourceReservation' });
      deps.logger.info('Resource reservation released', {
        workItemId: input.workItemId,
        resourceId: resource.id,
        reservationId: result.reservation.id,
      });
      return result.reservation;
    }
  );
}
