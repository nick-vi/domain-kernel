# ADR 0003: Commands, Outbox, And Projections

## Decision

Commands are explicit envelopes dispatched through registered handlers. Handlers
can validate payloads, authorize execution, opt into unit-of-work wrapping, and
return typed results.

The kernel provides a default command registry for generic use cases, but the
bus itself stays generic. Command execution requires an explicit actor resolver.

Audit events remain the write-side history. Outbox messages are written during
mutations and published by a worker, so publishing is not mixed into domain
changes.

Projections are derived read models. They can be cleared and rebuilt from audit
events, with checkpoints stored separately from source events.

The kernel provides reusable projection definitions for common read models:
work item summaries, audit timelines, and resource reservation summaries.

## Consequences

The command side and query side can evolve independently while still sharing the
same memory/filesystem adapters. Projection records are disposable derived state,
not the source of truth.
