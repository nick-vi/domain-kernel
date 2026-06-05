# ADR 0006: Projection And Package Evolution Tooling

## Decision

Projection records are derived state and can be verified against a rebuild.

Verification requires an explicit scratch projection store. The kernel does not
hide an adapter fallback. The verifier rebuilds the target projection into the
scratch store and compares projected values against the active store.

The CLI exposes projection list, rebuild, and verify commands for built-in
kernel projections. Verification requires `--scratch-dir` so temporary rebuild
storage is explicit.

Domain package evolution is reported from workflow and schema compatibility
rules. The report includes:

- compatibility status
- detected and required semantic-version bump
- workflow/schema findings
- migration kinds that are required and whether matching migrations exist

Packages may also include optional lifecycle metadata so packages can be marked
active, deprecated, or replaced without changing the core workflow/schema model.

## Consequences

Apps can detect read-model drift without treating projections as source of truth.
Tooling can be used in tests, local CLI workflows, or future CI checks.

Package authors can see whether a version change is compatible, needs migration
coverage, or is breaking before registration rules reject it.

The rules stay generic: every package uses the same schema/workflow evolution
model.
