import type { HealthCheckResult, HealthStatus } from '@/primitives/health';

export type HealthQuery = {
  status?: HealthStatus | undefined;
};

export interface HealthReporter {
  report(result: HealthCheckResult): Promise<void>;
  get(name: string): Promise<HealthCheckResult | null>;
  list(query?: HealthQuery): Promise<HealthCheckResult[]>;
}
