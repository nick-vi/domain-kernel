# ADR 0001: Domain Kernel Boundaries

## Decision

The repository is a generic domain kernel, not a product-specific application.

Core rules:

- `primitives` stay app-agnostic and dependency-light.
- `domain` owns generic domain models and invariants.
- `application` owns use cases, command dispatch, migrations, projections, and orchestration.
- `ports` define contracts before infrastructure choices exist.
- `adapters` implement ports for memory and filesystem only at this stage.
- app packages provide workflows, schemas, policies, fixtures, and integration glue.

## Consequences

The kernel can support many domains without renaming core concepts around one app.
Production infrastructure adapters are deferred until the memory/filesystem contracts
are strong enough to preserve behavior.
