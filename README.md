# Domain Kernel

A small generic foundation for building domain-driven apps.

## Why

Most apps eventually need the same durable foundations: clear boundaries,
validated inputs, workflow state, idempotent commands, audit history, events,
policies, projections, integration state, observability, and adapters that can
be swapped without rewriting domain logic.

Domain Kernel keeps those concerns generic. It is not a framework and it is not
an app template. It is a foundation layer for building app-specific packages and
services on top of stable primitives, ports, and use cases.

It gives you a clean place to model:

- work items
- workflows
- schemas
- package versions and migrations
- command handlers
- command idempotency
- command and event contract catalog
- default command registry
- policies
- resources and reservations
- audit history
- event stream revisions
- integrations
- generic import/export planning
- sync checkpoints
- projections
- projection verification
- projection snapshots
- built-in projection definitions
- W3C trace context-compatible tracing
- W3C baggage and carrier propagation
- trace sampling primitives
- telemetry resource metadata
- metric cardinality guards and exemplars
- correlated logging
- observability flush/shutdown lifecycle
- RFC 9457 problem details
- process managers / sagas
- process persistence
- metrics and health ports
- package test harness
- package evolution reports
- package dependency and capability graph
- explicit config
- generic primitives
- memory and filesystem adapters
- adapter conformance runner
- stable public API surface
- package build and consumer checks
- CLI use cases
- CLI inspection tools

Example packages are fixtures. The kernel itself should stay generic.

## Shape

```text
packages
  app-specific workflows, schemas, policies, fixtures, integrations

application
  use cases and orchestration

domain
  generic domain models and rules

ports
  interfaces for persistence, eventing, auth, policy, cache, observability

adapters
  memory, filesystem, CLI, logging, tracing, queries

primitives
  result, branch, decimal, units, state machine, commands, events, outbox,
  idempotency, calendar, sequence, cache, retry, context, concurrency,
  trace context, trace sampling, baggage, telemetry resources, problem details,
  process manager, projection snapshots, import/export planning, invariants,
  metrics, health
```

Dependencies should point down. Primitives should not know about apps. Domain
and application code should not know about concrete adapters.

Architecture decisions live in `docs/adr`.
Boundary data-shape rules are documented in
`docs/adr/0009-boundary-data-shapes.md`.
Small usage examples live in `docs/examples`.

## License

MIT.

## Observability

The kernel owns a small `Tracer` port and emits dependency-free trace, span, and
event records. Records carry W3C trace context fields and an OpenTelemetry span
kind mapping so application adapters can forward them to OpenTelemetry without
making OpenTelemetry part of the kernel contract.

The kernel also includes deterministic sampler primitives, bounded metric
attributes, optional metric exemplars, telemetry resources, correlated logging,
and explicit flush/shutdown hooks. It does not implement OTel providers,
processors, OTLP exporters, collectors, or vendor integrations.

## Package Use

The package export map points at `dist`, so build before consuming it through
package exports:

```sh
npm run build
```

The package is still marked private to prevent accidental registry publishing.
It is consumable from local workspaces and file dependencies after a build.

## Try It

```sh
npm install
npm run build
npm run domain -- --help
npm run domain -- init
npm run domain -- package scaffold sample-cases --type case --dir ./.data/packages
npm run domain -- package register ./.data/packages/sample-cases --json
npm run domain -- create case
npm run domain -- list --type case
```

Set `DOMAIN_KERNEL_DATA_DIR` to choose a filesystem data directory. The CLI also
accepts `--data-dir`. By default it uses `.data/domain-kernel`.

## Persistence

The filesystem adapters are for local, single-node use. They use atomic writes
and lock files, but they are not a replacement for database transactions.

For production, add a real database adapter with transactions, migrations,
locking, backups, and durable outbox processing.

## Checks

```sh
npm run check
```

That runs typecheck, tests, the package build, external consumer checks, and
dependency audit.
