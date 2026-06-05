import { NotFoundError, ValidationError } from '@/domain/errors/domain-error';
import {
  checkResourceCapacity,
  type ResourceReservation,
  ResourceReleaseRequest,
  ResourceReleaseResult,
  ResourceReservationListQuery,
  ResourceReservationRequest,
  ResourceReservationResult,
} from '@/domain/resource/resource';
import type { ResourceReservationPort } from '@/ports/resource-reservation';
import { compareStrings } from '@/primitives/string';

export class InMemoryResourceReservationPort implements ResourceReservationPort {
  private readonly reservations = new Map<string, ResourceReservation>();

  async reserve(input: ResourceReservationRequest): Promise<ResourceReservationResult> {
    const availability = checkResourceCapacity({
      resource: input.resource,
      activeReservations: this.listReservations({
        resourceId: input.resource.id,
        status: 'active',
      }),
      quantity: input.quantity,
    });
    if (!availability.available) {
      throw new ValidationError(availability.reason, {
        code: availability.code,
        resourceId: input.resource.id,
        workItemId: input.workItemId,
      });
    }

    const reservation: ResourceReservation = {
      id: input.id,
      resourceId: input.resource.id,
      resourceType: input.resource.type,
      workItemId: input.workItemId,
      ...(input.quantity != null ? { quantity: input.quantity } : {}),
      fields: input.fields ?? {},
      status: 'active',
      createdAt: input.occurredAt,
    };
    this.reservations.set(reservation.id, structuredClone(reservation));
    return { reservation: structuredClone(reservation) };
  }

  async release(input: ResourceReleaseRequest): Promise<ResourceReleaseResult> {
    const reservation = this.findActiveReservation(input);
    if (reservation == null) {
      throw new NotFoundError('Active resource reservation was not found', {
        resourceId: input.resourceId,
        workItemId: input.workItemId,
        quantity: input.quantity,
      });
    }

    const released: ResourceReservation = {
      ...reservation,
      status: 'released',
      releasedAt: input.occurredAt,
    };
    this.reservations.set(released.id, structuredClone(released));
    return { reservation: structuredClone(released) };
  }

  async list(query: ResourceReservationListQuery = {}): Promise<ResourceReservation[]> {
    return this.listReservations(query).map((reservation) => structuredClone(reservation));
  }

  private listReservations(
    query: ResourceReservationListQuery = {}
  ): ResourceReservation[] {
    return [...this.reservations.values()]
      .filter(
        (reservation) => query.resourceId == null || reservation.resourceId === query.resourceId
      )
      .filter(
        (reservation) => query.workItemId == null || reservation.workItemId === query.workItemId
      )
      .filter((reservation) => query.status == null || reservation.status === query.status)
      .sort(
        (left, right) =>
          compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id)
      );
  }

  private findActiveReservation(input: ResourceReleaseRequest): ResourceReservation | null {
    return (
      [...this.reservations.values()]
        .filter((reservation) => reservation.status === 'active')
        .filter((reservation) => reservation.resourceId === input.resourceId)
        .filter((reservation) => reservation.workItemId === input.workItemId)
        .filter((reservation) => input.quantity == null || reservation.quantity === input.quantity)
        .sort(
          (left, right) =>
            compareStrings(left.createdAt, right.createdAt) || compareStrings(left.id, right.id)
        )[0] ??
      null
    );
  }
}
