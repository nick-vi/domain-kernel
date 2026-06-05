# Kernel Tools

Small app-agnostic examples for the local filesystem kernel.

## Packages

```sh
npm run domain -- package scaffold sample-cases --type case --dir ./.data/packages
npm run domain -- package test ./.data/packages/sample-cases --json
npm run domain -- package register ./.data/packages/sample-cases --json
npm run domain -- package graph --json
npm run domain -- package contracts --asyncapi
```

## Event Streams

```sh
npm run domain -- events stream work_001 --json
npm run domain -- events stream work_001 --from-revision 1 --limit 50 --json
```

## Inspection

```sh
npm run domain -- projection list --json
npm run domain -- projection rebuild all --json
npm run domain -- projection verify all --scratch-dir ./.data/projection-scratch --json
npm run domain -- process list --status waiting --json
npm run domain -- process due-timeouts --now 2026-06-04T12:00:00.000Z --json
npm run domain -- health list --status pass --json
npm run domain -- idempotency list --json
npm run domain -- idempotency prune --now 2026-06-04T12:00:00.000Z --json
```

## Idempotent Commands

```ts
import { application, primitives } from 'domain-kernel';

const result = await commandBus.dispatch(
  primitives.command({
    id: ids.nextId('cmd'),
    type: application.KernelCommandType.WorkCreate,
    payload: {
      type: 'case',
      fields: { title: 'Example case', priority: 'normal' },
    },
    idempotencyKey: 'case:create:client-request-001',
    occurredAt: clock.now(),
  })
);
```

Retrying the same key with the same command type and payload replays the stored
result. Reusing the key with different payload fails.

## Projection Verification

```ts
import {
  application,
  memoryAdapters,
} from 'domain-kernel';

const report = await application.verifyProjection(
  deps,
  application.createWorkItemSummaryProjection(),
  {
    scratchStore: new memoryAdapters.InMemoryProjectionStore(),
  }
);

if (report.status === 'drifted') {
  console.log(report.differences);
}
```
