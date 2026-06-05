# Build An App Package

An app package is a small directory that adds one domain concept to the kernel.

Use generic names. The same shape can model cases, assets, records, requests,
or any other workflow-backed concept.

## Files

```text
my-package/
  domain-package.json
  workflow.json
  schema.json
  migrations.json
  fixtures/
    basic.json
```

## Manifest

```json
{
  "name": "my-package",
  "version": "1.0.0",
  "lifecycle": {
    "status": "active"
  }
}
```

Use `deprecated` or `replaced` when a package should stay readable but should no
longer be used for new work.

## Workflow

```json
{
  "type": "item",
  "states": ["draft", "active", "closed"],
  "transitions": [
    { "action": "activate", "from": "draft", "to": "active" },
    { "action": "close", "from": "active", "to": "closed" }
  ],
  "closedStates": ["closed"]
}
```

## Schema

```json
{
  "type": "item",
  "fields": {
    "name": { "type": "string", "required": true, "minLength": 1 },
    "quantity": { "type": "number" },
    "tags": { "type": "array" }
  }
}
```

## Fixture

```json
{
  "type": "item",
  "fields": {
    "name": "Example",
    "quantity": 1,
    "tags": ["sample"]
  }
}
```

## Commands

```sh
npm run domain -- package test ./my-package --json
npm run domain -- package register ./my-package --json
npm run domain -- package graph --json
npm run domain -- package diff my-package --from 1.0.0 --to 1.1.0 --json
```

Keep package-specific behavior in the package. Keep primitives and kernel
application services app-agnostic.
