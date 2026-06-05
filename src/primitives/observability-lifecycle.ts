export const ObservabilityLifecycleErrorKind = Object.freeze({
  Shutdown: 'shutdown',
} as const);

export type ObservabilityLifecycleErrorKind =
  (typeof ObservabilityLifecycleErrorKind)[keyof typeof ObservabilityLifecycleErrorKind];

export class ObservabilityLifecycleError extends Error {
  override readonly name = 'ObservabilityLifecycleError';

  constructor(
    readonly kind: ObservabilityLifecycleErrorKind,
    message: string
  ) {
    super(message);
  }
}

export function assertObservabilityOpen(closed: boolean, component: string): void {
  if (!closed) return;

  throw new ObservabilityLifecycleError(
    ObservabilityLifecycleErrorKind.Shutdown,
    `${component} has been shut down`
  );
}
