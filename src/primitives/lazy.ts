export type LazyValue<T> = {
  (): T;
  isReady(): boolean;
  reset(): void;
};

export function lazy<T>(factory: () => T): LazyValue<T>;
export function lazy<T>(factory: () => Promise<T>): LazyValue<Promise<T>>;
export function lazy<T>(factory: () => T | Promise<T>): LazyValue<T | Promise<T>> {
  let value: T | undefined;
  let ready = false;
  let pending: Promise<T> | undefined;
  let asyncMode = false;

  const get = (): T | Promise<T> => {
    if (ready) return asyncMode ? Promise.resolve(value as T) : (value as T);
    if (pending != null) return pending;

    const result = factory();
    if (isPromiseLike<T>(result)) {
      asyncMode = true;
      pending = result.then(
        (resolved) => {
          value = resolved;
          ready = true;
          pending = undefined;
          return resolved;
        },
        (error) => {
          pending = undefined;
          throw error;
        }
      );
      return pending;
    }

    value = result;
    ready = true;
    return result;
  };

  Object.defineProperties(get, {
    isReady: {
      value: () => ready,
      enumerable: true,
    },
    reset: {
      value: () => {
        value = undefined;
        ready = false;
        pending = undefined;
      },
      enumerable: true,
    },
  });

  return get as LazyValue<T | Promise<T>>;
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === 'object' && value !== null && 'then' in value;
}
