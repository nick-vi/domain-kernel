export type UnitOfWorkOptions = {
  name?: string | undefined;
};

export interface UnitOfWorkManager {
  run<T>(fn: () => Promise<T>, options?: UnitOfWorkOptions): Promise<T>;
}
