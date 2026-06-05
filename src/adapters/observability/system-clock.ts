import type { Clock } from '@/ports/clock';

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}
