export function anyOf<T>(...predicates: Array<(value: T) => boolean>): (value: T) => boolean {
  return (value) => predicates.some((predicate) => predicate(value));
}

export function allOf<T>(...predicates: Array<(value: T) => boolean>): (value: T) => boolean {
  return (value) => predicates.every((predicate) => predicate(value));
}
