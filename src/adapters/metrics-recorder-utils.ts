import type { MetricQuery } from '@/ports/metrics';
import type { MetricMeasurement } from '@/primitives/metrics';
import { compareStrings } from '@/primitives/string';

export function filterMetricMeasurements(
  measurements: readonly MetricMeasurement[],
  query: MetricQuery = {}
): MetricMeasurement[] {
  return measurements
    .filter((measurement) => query.name == null || measurement.name === query.name)
    .filter((measurement) => query.kind == null || measurement.kind === query.kind)
    .sort(compareMetricMeasurements);
}

export function compareMetricMeasurements(
  left: MetricMeasurement,
  right: MetricMeasurement
): number {
  return compareStrings(left.observedAt, right.observedAt) || compareStrings(left.name, right.name);
}
