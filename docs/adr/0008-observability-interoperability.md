# 0008 Observability Interoperability

Status: accepted

Date: 2026-06-05

## Context

The kernel has its own `Tracer` port, `ObservabilityExporter`, span records, and
W3C trace context propagation primitives. That is enough for local tracing,
tests, and dependency-free domain/application code.

Many real apps already run OpenTelemetry SDKs, collectors, and vendor exporters.
OpenTelemetry also models span context around W3C Trace Context:
<https://opentelemetry.io/docs/specs/otel/trace/api/>.

Relevant interoperability constraints:

- W3C Trace Context defines `traceparent`, `tracestate`, and the sampled flag:
  <https://www.w3.org/TR/trace-context/>.
- OpenTelemetry separates recording from sampled/exported spans and defines
  built-in sampler shapes:
  <https://opentelemetry.io/docs/specs/otel/trace/sdk/>.
- OpenTelemetry metrics define reader/exporter lifecycle, cardinality limits,
  overflow handling, and exemplars:
  <https://opentelemetry.io/docs/specs/otel/metrics/sdk/>.
- OpenTelemetry resources attach immutable observed-entity metadata to traces,
  metrics, and logs:
  <https://opentelemetry.io/docs/specs/otel/resource/sdk/>.
- Trace correlation in non-OTLP logs uses trace id, span id, and trace flags:
  <https://opentelemetry.io/docs/specs/otel/compatibility/logging_trace_context/>.

## Decision

Keep the kernel tracer as the canonical kernel contract.

Do not add OpenTelemetry as a core dependency. OpenTelemetry support belongs in
an adapter or app package that subscribes to `ObservabilityExporter` records and
maps them into the app's OpenTelemetry SDK.

Kernel span records should keep:

- W3C trace ids, span ids, `traceparent`, `tracestate`, and trace flags
- kernel-native span kind names for domain readability
- `otelKind` for direct mapping to OpenTelemetry's five span kinds
- attributes, events, outputs, status, timing, and serialized errors

Kernel observability should provide:

- deterministic sampler primitives: always-on, always-off, record-only,
  parent-based, and trace-id-ratio
- explicit recording vs sampled state
- bounded metric attributes and deterministic overflow markers
- optional metric exemplars linked to sampled span context
- telemetry resource metadata with schema-aware merge behavior
- log correlation helpers that add active trace context to log entries
- `forceFlush` and `shutdown` lifecycle hooks on observability ports

Kernel observability should not provide:

- OpenTelemetry global providers
- span processors or metric readers that mimic the OTel SDK lifecycle
- OTLP, collector, or vendor exporters
- broad semantic-convention packages
- automatic environment/resource detection beyond explicit app input

## Consequences

Apps can use the built-in tracer without any observability stack.

Apps that already use OpenTelemetry can bridge kernel records into their existing
pipeline without changing domain/application code.

The kernel avoids SDK lifecycle concerns such as global providers, processors,
exporter shutdown, sampling configuration, and vendor-specific packages.

The kernel still exposes enough shape for adapters to preserve trace ids,
sampling flags, resource attributes, metric overflow/exemplars, and log
correlation when forwarding records to OpenTelemetry or another backend.
