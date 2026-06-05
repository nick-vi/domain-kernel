import { positiveIntegerOption } from './runtime-options';

export type SlidingWindowClock = {
  now(): number;
};

export type SlidingWindowConfig = {
  windowMs: number;
  maxEvents: number;
  clock: SlidingWindowClock;
};

export type SlidingWindowState = {
  timestamps: number[];
};

export class SlidingWindow {
  private timestamps: number[] = [];
  private readonly windowMs: number;
  private readonly maxEvents: number;
  private readonly clock: SlidingWindowClock;

  constructor(config: SlidingWindowConfig) {
    this.windowMs = positiveIntegerOption('windowMs', config.windowMs);
    this.maxEvents = positiveIntegerOption('maxEvents', config.maxEvents);
    this.clock = config.clock;
  }

  static fromState(state: SlidingWindowState, config: SlidingWindowConfig): SlidingWindow {
    const window = new SlidingWindow(config);
    window.timestamps = [...state.timestamps].sort((left, right) => left - right);
    window.prune();
    return window;
  }

  toState(): SlidingWindowState {
    this.prune();
    return { timestamps: [...this.timestamps] };
  }

  canRecord(): boolean {
    this.prune();
    return this.timestamps.length < this.maxEvents;
  }

  record(timestamp = this.clock.now()): boolean {
    this.prune();
    if (this.timestamps.length >= this.maxEvents) return false;
    this.timestamps.push(timestamp);
    this.timestamps.sort((left, right) => left - right);
    return true;
  }

  get count(): number {
    this.prune();
    return this.timestamps.length;
  }

  get remaining(): number {
    this.prune();
    return Math.max(0, this.maxEvents - this.timestamps.length);
  }

  msUntilAvailable(): number {
    this.prune();
    if (this.timestamps.length < this.maxEvents) return 0;
    const oldest = this.timestamps[0] as number;
    return Math.max(0, oldest + this.windowMs - this.clock.now());
  }

  reset(): void {
    this.timestamps = [];
  }

  private prune(): void {
    const cutoff = this.clock.now() - this.windowMs;
    this.timestamps = this.timestamps.filter((timestamp) => timestamp > cutoff);
  }
}
