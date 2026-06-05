export type { JsonObject, JsonPrimitive, JsonValue } from '@/primitives/json-value';

export function assertNonEmptyString(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be empty`);
  }
}
