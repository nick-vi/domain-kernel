# ADR 0002: Package Versioning And Migrations

## Decision

Domain packages use semantic versions and treat workflow/schema shape as their
public API.

Registration rules:

- same package name and version must be immutable
- new versions must increase
- compatible public additions require at least a minor version bump
- breaking workflow/schema changes require a major version bump
- migrations describe how data moves between versions
- migrations are recorded explicitly when applied

Package directories may include:

- `domain-package.json`
- `workflow.json`
- `schema.json`
- `migrations.json`
- `fixtures/`

## Consequences

Version intent is checked before packages are registered. Migration execution is
kept generic: the kernel can plan, dry-run, apply, and record steps, while app
packages provide handlers for domain-specific data transformations.
