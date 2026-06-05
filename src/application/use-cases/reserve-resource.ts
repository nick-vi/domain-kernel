import { authorize } from '@/application/authorization';
import { recordAuditEvent } from '@/application/audit';
import type { ApplicationDependencies } from '@/application/dependencies';
import type { Actor } from '@/domain/auth/auth';
import type { ResourceReservedEvent } from '@/domain/event/audit-event';
import { NotFoundError, ValidationError } from '@/domain/errors/domain-error';
import type { ResourceReservation } from '@/domain/resource/resource';
import type { JsonObject } from '@/domain/shared';

export type ReserveResourceInput = {
  workItemId: string;
  resourceId: string;
  quantity?: number | undefined;
  fields?: JsonObject | undefined;
  actor: Actor;
};

export async function reserveResourceUseCase(
  deps: ApplicationDependencies,
  input: ReserveResourceInput
): Promise<ResourceReservation> {
  return deps.tracer.span(
    'reserveResource',
    { workItemId: input.workItemId, resourceId: input.resourceId },
    async () => {
      authorize(deps, input.actor, 'resource:reserve');
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

      const availability = await deps.resourceAvailability.check({
        resource,
        workItemId: input.workItemId,
        quantity: input.quantity,
        fields: input.fields,
      });
      if (!availability.available) {
        throw new ValidationError(availability.reason, {
          code: availability.code,
          resourceId: resource.id,
          workItemId: input.workItemId,
        });
      }

      const result = await deps.unitOfWork.run(async () => {
        const occurredAt = deps.clock.now();
        const reservationResult = await deps.resourceReservations.reserve({
          id: deps.ids.nextId('resv'),
          resource,
          workItemId: input.workItemId,
          quantity: input.quantity,
          fields: input.fields,
          occurredAt,
        });

        const event: ResourceReservedEvent = {
          id: deps.ids.nextId('evt'),
          type: 'ResourceReserved',
          workItemId: input.workItemId,
          resourceId: resource.id,
          resourceType: resource.type,
          reservationId: reservationResult.reservation.id,
          ...(reservationResult.reservation.quantity != null
            ? { quantity: reservationResult.reservation.quantity }
            : {}),
          actorId: input.actor.id,
          occurredAt,
        };

        await recordAuditEvent(deps, event);
        return reservationResult;
      }, { name: 'reserveResource' });
      deps.logger.info('Resource reserved', {
        workItemId: input.workItemId,
        resourceId: resource.id,
        reservationId: result.reservation.id,
      });
      return result.reservation;
    }
  );
}
