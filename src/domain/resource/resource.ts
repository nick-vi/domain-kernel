import type { JsonObject } from '@/domain/shared';

export type ResourceType = string;

export type Resource = {
  id: string;
  type: ResourceType;
  fields: JsonObject;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type ResourceReservationStatus = 'active' | 'released';

export type ResourceReservation = {
  id: string;
  resourceId: string;
  resourceType: ResourceType;
  workItemId: string;
  quantity?: number | undefined;
  fields: JsonObject;
  status: ResourceReservationStatus;
  createdAt: string;
  releasedAt?: string | undefined;
};

export type ResourceAvailabilityRequest = {
  resource: Resource;
  workItemId: string;
  quantity?: number | undefined;
  fields?: JsonObject | undefined;
};

export type ResourceAvailabilityResult =
  | { available: true }
  | { available: false; code: string; reason: string };

export type ResourceReservationRequest = {
  id: string;
  resource: Resource;
  workItemId: string;
  quantity?: number | undefined;
  fields?: JsonObject | undefined;
  occurredAt: string;
};

export type ResourceReservationResult = {
  reservation: ResourceReservation;
};

export type AllocationRequest = ResourceReservationRequest;
export type AllocationResult = ResourceReservationResult;

export type ResourceReleaseRequest = {
  resourceId: string;
  workItemId: string;
  quantity?: number | undefined;
  occurredAt: string;
};

export type ResourceReleaseResult = {
  reservation: ResourceReservation;
};

export type ResourceListQuery = {
  type?: ResourceType | undefined;
};

export type ResourceReservationListQuery = {
  resourceId?: string | undefined;
  workItemId?: string | undefined;
  status?: ResourceReservationStatus | undefined;
};

export function createResource(input: {
  id: string;
  type: ResourceType;
  fields?: JsonObject | undefined;
  occurredAt: string;
}): Resource {
  return {
    id: input.id,
    type: input.type,
    fields: input.fields ?? {},
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    version: 1,
  };
}

export function checkResourceCapacity(input: {
  resource: Resource;
  activeReservations: readonly ResourceReservation[];
  quantity?: number | undefined;
}): ResourceAvailabilityResult {
  if (input.quantity != null && input.quantity <= 0) {
    return {
      available: false,
      code: 'invalid_quantity',
      reason: 'Reservation quantity must be positive',
    };
  }

  const capacity = input.resource.fields.quantity;
  if (typeof capacity !== 'number') return { available: true };

  const requested = input.quantity ?? capacity;
  const reserved = input.activeReservations.reduce(
    (sum, reservation) => sum + (reservation.quantity ?? capacity),
    0
  );

  if (reserved + requested > capacity) {
    return {
      available: false,
      code: 'capacity_exceeded',
      reason: `Resource "${input.resource.id}" has insufficient remaining quantity`,
    };
  }

  return { available: true };
}
