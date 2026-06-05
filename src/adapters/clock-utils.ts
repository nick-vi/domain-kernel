import type { Clock } from '@/ports/clock';
import { isoTimestampEpochMs } from '@/primitives/time';

export function clockEpochMilliseconds(clock: Clock): number {
  const timestamp = isoTimestampEpochMs(clock.now(), 'clock.now');
  if (!timestamp.ok) throw timestamp.error;
  return timestamp.value;
}
