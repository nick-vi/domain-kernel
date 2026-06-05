import type { MetricQuery, MetricsRecorder } from '@/ports/metrics';
import type { Clock } from '@/ports/clock';
import { metric, type MetricMeasurement } from '@/primitives/metrics';
import { assertObservabilityOpen } from '@/primitives/observability-lifecycle';
import type { SleepFunction } from '@/primitives/timing';
import { MetricMeasurementSchema } from '@/validation/schemas';
import { filterMetricMeasurements } from '../metrics-recorder-utils';
import {
  appendJsonl,
  readJsonl,
  removePath,
  safeJoin,
} from './fs-utils';

export class FsMetricsRecorder implements MetricsRecorder {
  private readonly path: string;
  private closed = false;

  constructor(dataDir: string, private readonly clock: Clock, private readonly sleep: SleepFunction) {
    this.path = safeJoin(dataDir, 'observability', 'metrics.jsonl');
  }

  async record(measurement: MetricMeasurement): Promise<void> {
    assertObservabilityOpen(this.closed, 'FsMetricsRecorder');
    await appendJsonl(this.path, metric(measurement), { clock: this.clock, sleep: this.sleep });
  }

  async list(query: MetricQuery = {}): Promise<MetricMeasurement[]> {
    assertObservabilityOpen(this.closed, 'FsMetricsRecorder');
    const measurements = await readJsonl<MetricMeasurement>(this.path, MetricMeasurementSchema);
    return filterMetricMeasurements(measurements, query);
  }

  async clear(): Promise<void> {
    assertObservabilityOpen(this.closed, 'FsMetricsRecorder');
    await removePath(this.path);
  }

  async forceFlush(): Promise<void> {
    assertObservabilityOpen(this.closed, 'FsMetricsRecorder');
  }

  async shutdown(): Promise<void> {
    this.closed = true;
  }
}
