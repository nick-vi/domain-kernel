import type { UnitOfWorkManager, UnitOfWorkOptions } from '@/ports/unit-of-work-manager';

export class InMemoryUnitOfWorkManager implements UnitOfWorkManager {
  async run<T>(fn: () => Promise<T>, _options: UnitOfWorkOptions = {}): Promise<T> {
    return fn();
  }
}
