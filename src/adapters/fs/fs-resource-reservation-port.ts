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
import type { Clock } from '@/ports/clock';
import type { ResourceReservationPort } from '@/ports/resource-reservation';
import { compareStrings } from '@/primitives/string';
import type { SleepFunction } from '@/primitives/timing';
import { ResourceReservationSchema } from '@/validation/schemas';
import {
  filenameForId,
  listFilesRecursive,
  readJson,
  safeJoin,
  type FileTempNames,
  withFileLock,
  writeJsonAtomic,
} from './fs-utils';

export class FsResourceReservationPort implements ResourceReservationPort {
  private readonly root: string;

  constructor(
    dataDir: string,
    private readonly clock: Clock,
    private readonly sleep: SleepFunction,
    private readonly tempNames: FileTempNames
  ) {
    this.root = safeJoin(dataDir, 'resource-reservations');
  }

  async reserve(input: ResourceReservationRequest): Promise<ResourceReservationResult> {
    return withFileLock(this.resourceLockPathFor(input.resource.id), async () => {
      const availability = checkResourceCapacity({
        resource: input.resource,
        activeReservations: await this.list({ resourceId: input.resource.id, status: 'active' }),
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
      await this.save(reservation);
      return { reservation };
    }, { clock: this.clock, sleep: this.sleep });
  }

  async release(input: ResourceReleaseRequest): Promise<ResourceReleaseResult> {
    return withFileLock(this.resourceLockPathFor(input.resourceId), async () => {
      const reservation = await this.findActiveReservation(input);
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
      await this.save(released);
      return { reservation: released };
    }, { clock: this.clock, sleep: this.sleep });
  }

  async list(query: ResourceReservationListQuery = {}): Promise<ResourceReservation[]> {
    const files = await listFilesRecursive(this.root);
    const reservations = await Promise.all(
      files.map((file) => readJson<ResourceReservation>(file, ResourceReservationSchema))
    );
    return reservations
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

  private async findActiveReservation(
    input: ResourceReleaseRequest
  ): Promise<ResourceReservation | null> {
    return (
      (await this.list({
        resourceId: input.resourceId,
        workItemId: input.workItemId,
        status: 'active',
      }))
        .filter((reservation) => input.quantity == null || reservation.quantity === input.quantity)[0] ??
      null
    );
  }

  private async save(reservation: ResourceReservation): Promise<void> {
    await writeJsonAtomic(this.pathFor(reservation.id), reservation, this.tempNames);
  }

  private pathFor(id: string): string {
    return safeJoin(this.root, filenameForId(id));
  }

  private resourceLockPathFor(resourceId: string): string {
    return safeJoin(this.root, 'locks', filenameForId(resourceId));
  }
}
