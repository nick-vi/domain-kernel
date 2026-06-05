import type {
  ResourceAvailabilityRequest,
  ResourceAvailabilityResult,
} from '@/domain/resource/resource';

export interface ResourceAvailabilityPort {
  check(input: ResourceAvailabilityRequest): Promise<ResourceAvailabilityResult>;
}
