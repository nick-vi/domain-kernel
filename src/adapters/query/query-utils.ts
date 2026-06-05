import type { JsonValue } from '@/domain/shared';
import { Json } from '@/primitives/json';
import { normalizePaginationOptions } from '@/primitives/runtime-options';

export function paginate<T>(
  items: T[],
  query: { limit?: number | undefined; offset?: number | undefined }
): { items: T[]; total: number; limit: number; offset: number } {
  const { limit, offset } = normalizePaginationOptions(query, items.length);
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}

export function jsonValueEquals(left: JsonValue | undefined, right: JsonValue): boolean {
  if (left === undefined) return false;
  return Json.stableStringify(left).unwrap() === Json.stableStringify(right).unwrap();
}
