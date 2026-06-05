export class RoundRobin<T> {
  private index = 0;
  private readonly items: readonly T[];

  constructor(items: readonly T[]) {
    if (items.length === 0) {
      throw new Error('RoundRobin requires at least one item');
    }
    this.items = Object.freeze([...items]);
  }

  next(): T {
    const item = this.items[this.index] as T;
    this.index = (this.index + 1) % this.items.length;
    return item;
  }

  peek(): T {
    return this.items[this.index] as T;
  }

  reset(): void {
    this.index = 0;
  }

  get size(): number {
    return this.items.length;
  }

  all(): readonly T[] {
    return this.items;
  }
}
