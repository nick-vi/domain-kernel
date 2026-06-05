import type {
  ResourceReleaseRequest,
  ResourceReleaseResult,
  ResourceReservation,
  ResourceReservationListQuery,
  ResourceReservationRequest,
  ResourceReservationResult,
} from '@/domain/resource/resource';

export interface ResourceReservationPort {
  reserve(input: ResourceReservationRequest): Promise<ResourceReservationResult>;
  release(input: ResourceReleaseRequest): Promise<ResourceReleaseResult>;
  list(query?: ResourceReservationListQuery): Promise<ResourceReservation[]>;
}
