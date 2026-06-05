type Case = {
  value: unknown;
  cb: (value: never) => unknown;
};

export class BranchBuilder<T = never> {
  private readonly cases: Case[] = [];

  if<V, R>(value: V, cb: (value: NonNullable<V>) => R): BranchBuilder<T | R> {
    this.cases.push({ value, cb: cb as Case['cb'] });
    return this as unknown as BranchBuilder<T | R>;
  }

  else<R>(fallback: R | (() => R)): T | R {
    for (const item of this.cases) {
      if (item.value) return item.cb(item.value as never) as T | R;
    }
    return (typeof fallback === 'function' ? (fallback as () => R)() : fallback) as T | R;
  }
}

export function branch<T = never>(): BranchBuilder<T> {
  return new BranchBuilder<T>();
}
