export type Scope = {
  tenantId?: string | undefined;
  workspaceId?: string | undefined;
  environment?: string | undefined;
  partition?: string | undefined;
};

export const GLOBAL_SCOPE: Scope = Object.freeze({});

export function scope(input: Scope = {}): Scope {
  return {
    ...(nonEmpty(input.tenantId) ? { tenantId: input.tenantId.trim() } : {}),
    ...(nonEmpty(input.workspaceId) ? { workspaceId: input.workspaceId.trim() } : {}),
    ...(nonEmpty(input.environment) ? { environment: input.environment.trim() } : {}),
    ...(nonEmpty(input.partition) ? { partition: input.partition.trim() } : {}),
  };
}

export function scopeKey(value: Scope = GLOBAL_SCOPE): string {
  const normalized = scope(value);
  const parts = [
    ['tenant', normalized.tenantId],
    ['workspace', normalized.workspaceId],
    ['environment', normalized.environment],
    ['partition', normalized.partition],
  ]
    .filter(([, part]) => part != null)
    .map(([name, part]) => `${name}:${encodeURIComponent(part!)}`);

  return parts.length === 0 ? 'global' : parts.join('|');
}

export function scopeMatches(candidate: Scope | undefined, expected: Scope | undefined): boolean {
  return scopeKey(candidate ?? GLOBAL_SCOPE) === scopeKey(expected ?? GLOBAL_SCOPE);
}

export function isGlobalScope(value: Scope | undefined): boolean {
  return scopeKey(value ?? GLOBAL_SCOPE) === scopeKey(GLOBAL_SCOPE);
}

function nonEmpty(value: string | undefined): value is string {
  return value != null && value.trim().length > 0;
}
