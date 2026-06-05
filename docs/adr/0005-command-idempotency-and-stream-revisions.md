# ADR 0005: Command Idempotency And Stream Revisions

## Decision

Mutating commands may carry an explicit `idempotencyKey`.

The command bus validates payloads before idempotency records are created. When a
key is present, the bus records a stable fingerprint of the command type, payload,
actor, and metadata before command execution starts.

Rules:

- same key and same fingerprint replays the stored result
- same key and different fingerprint fails as a key conflict
- active in-progress keys fail instead of running duplicate work
- expired in-progress leases can be restarted by a matching command
- successful and failed executions are both recorded
- in-progress and replay leases are explicit command bus options
- records without a relevant lease are not implicitly expired
- pruning expired records is an explicit store/CLI operation
- persisted successful responses must be JSON-serializable
- command ids and timestamps are not part of the retry fingerprint

Audit events remain append-only and carry stream revisions. Appends can require
`no_stream`, `stream_exists`, an exact numeric revision, or `any`.

## Consequences

Retries can be safe without putting duplicate-checking logic in every handler.
Handlers stay focused on domain work, while the bus owns command-level replay
semantics.

Filesystem and memory adapters expose the same idempotency and stream-revision
contracts. Production adapters must preserve atomic begin/mark behavior and
optimistic stream conflicts.

This follows the same broad shape as idempotent mutating APIs such as Stripe
idempotency keys and event stores with expected-revision appends.
