# ADR 0004: Error Boundaries

## Decision

The kernel uses different error styles at different boundaries.

Rules:

- primitives return `Result` for expected failures
- parse and validation helpers return `Result`
- domain functions throw typed domain errors for violated invariants
- application use cases throw typed domain errors at orchestration boundaries
- adapters throw typed errors when port contracts cannot be fulfilled
- CLI code catches and formats errors for humans and scripts
- JSON helpers reject values that cannot be represented as stable JSON instead
  of relying on `JSON.stringify` omissions or `undefined` output
- Stable JSON helpers recursively order object properties by raw string
  comparison and avoid native object key reordering for hashes/equality
- Timestamp helpers accept only canonical UTC ISO instants
  (`YYYY-MM-DDTHH:mm:ss.sssZ`) at kernel boundaries; offset, local-time, and
  implementation-dependent `Date.parse` forms are rejected

## Consequences

Low-level utilities can be composed without exceptions for ordinary failure
paths. Domain and application boundaries remain direct to call and easy to
fail fast. CLI output stays centralized instead of leaking stack traces or
adapter details into command implementations.
