# ADR 0007: Operational Inspection CLI

## Decision

The CLI exposes kernel inspection commands for local development and tests.

Supported inspection surfaces:

- package test, graph, contracts, and diff
- event stream state and stored revisions
- process lists and due timeouts
- health reports

CLI commands build explicit filesystem dependencies from configuration. They do
not create production infrastructure adapters and do not hide fallback paths.

Contracts can be exported as a compact kernel document or as AsyncAPI 3.1.0 for
message-oriented tooling.

## Consequences

The kernel can be exercised as a bootstrap repo without choosing a database,
queue, scheduler, or observability backend.

Future production apps can keep the same ports while adding real adapters behind
them. The CLI remains useful for local smoke tests, package authoring, and
debugging filesystem-backed fixtures.
