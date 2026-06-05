import type {
  ResourceAvailabilityRequest,
  ResourceAvailabilityResult,
} from '@/domain/resource/resource';
import { checkResourceCapacity } from '@/domain/resource/resource';
import type { ResourceAvailabilityPort } from '@/ports/resource-availability';
import type { ResourceReservationPort } from '@/ports/resource-reservation';

export class AllowAllAvailabilityPort implements ResourceAvailabilityPort {
  async check(_input: ResourceAvailabilityRequest): Promise<ResourceAvailabilityResult> {
    return { available: true };
  }
}

export class ReservationAvailabilityPort implements ResourceAvailabilityPort {
  constructor(private readonly reservations: ResourceReservationPort) {}

  async check(input: ResourceAvailabilityRequest): Promise<ResourceAvailabilityResult> {
    const active = await this.reservations.list({
      resourceId: input.resource.id,
      status: 'active',
    });

    return checkResourceCapacity({
      resource: input.resource,
      activeReservations: active,
      quantity: input.quantity,
    });
  }
}
