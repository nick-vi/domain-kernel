import type { UnitOfWorkManager, UnitOfWorkOptions } from '@/ports/unit-of-work-manager';
import type { Clock } from '@/ports/clock';
import type { SleepFunction } from '@/primitives/timing';
import { safeJoin, withFileLock } from './fs-utils';

export class FsUnitOfWorkManager implements UnitOfWorkManager {
  private readonly lockPath: string;

  constructor(dataDir: string, private readonly clock: Clock, private readonly sleep: SleepFunction) {
    this.lockPath = safeJoin(dataDir, 'unit-of-work', 'unit-of-work');
  }

  async run<T>(fn: () => Promise<T>, _options: UnitOfWorkOptions = {}): Promise<T> {
    return withFileLock(this.lockPath, fn, { clock: this.clock, sleep: this.sleep });
  }
}
