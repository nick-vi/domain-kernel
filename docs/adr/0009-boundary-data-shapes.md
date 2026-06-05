# ADR 0009: Boundary Data Shapes

Status: accepted

Date: 2026-06-10

## Context

The kernel exposes domain records, use-case input types, port contracts, query
results, event records, outbox messages, projections, and persistence adapters.

Adding a broad DTO layer for every port would make every boundary explicit, but
many current shapes are already canonical kernel records. Duplicating those
records as DTOs would add mapper code that only returns the same shape, creates
extra files to maintain, and can drift accidentally without adding real
isolation.

Relevant architectural guidance:

- DTOs are most useful when data crosses process boundaries or remote
  interfaces, where serialized transfer shape matters.
- Hexagonal architecture isolates external actors and devices through ports and
  adapters, but does not require every internal port to duplicate domain data.
- Clean Architecture dependency rules protect inner policies from outer
  implementation details, while full boundaries have real maintenance cost.
- DDD repository abstractions keep persistence concerns out of the domain, but
  persistence realities should still be modeled when storage has its own shape,
  version, or lifecycle.

## Decision

Do not add a blanket DTO layer.

Use canonical kernel records across internal ports when all of these are true:

- the shape is owned by the kernel
- the shape has no external owner
- the shape has no independent storage or API version lifecycle
- serialization does not require additional fields, omissions, or transforms
- the mapper would be a pass-through copy

Add explicit DTO, snapshot, record, or mapper types at boundaries when at least
one of these is true:

- an external API, UI, vendor, or integration owns the shape
- the shape crosses a process or network boundary
- persistence needs metadata, schema versions, compatibility transforms, or a
  storage shape that differs from the domain record
- the read model is denormalized or optimized for query behavior
- serialization requires field renames, coercion, redaction, defaults, or
  backwards compatibility
- an adapter would otherwise leak infrastructure details into domain,
  application, or primitive code

Naming conventions:

- `Input` is used for use-case and command inputs.
- `Query` is used for query/filter contracts.
- `Record` is used for durable operational records.
- `Snapshot` is used for persisted or derived point-in-time state.
- `Dto` is reserved for external API, vendor, or process-boundary transfer
  shapes.
- Mapper functions should live close to the adapter or boundary that needs the
  translation.

Existing examples that should keep their separate boundary shapes:

- `StoredAuditEvent`, because stream revision and storage metadata differ from
  domain events.
- `OutboxMessage`, because it is a delivery/persistence record.
- `ProjectionRecord` and `ProjectionSnapshot`, because projections are derived
  read state.
- `SyncCheckpoint`, because sync state tracks integration progress.

Potential future candidates:

- `WorkflowSnapshot`, if workflows gain stored revisions, migration metadata, or
  compatibility transforms.
- `DomainPackageManifest` or `DomainPackageSnapshot`, if package persistence
  diverges from the canonical package record.
- External adapter DTOs for HTTP, GraphQL, message brokers, vendor sync, import,
  or export boundaries.

## Consequences

The kernel stays small and readable while preserving a clear rule for when
boundary shapes must become explicit.

Internal ports can continue to use stable canonical records without DTO
ceremony.

Adapters that face external systems or divergent persistence formats must own
their DTOs, snapshots, records, and mappers instead of leaking those shapes
inward.

If a canonical record starts accumulating fields that exist only for one
adapter, that is a signal to introduce a boundary shape and mapper at that
adapter.
