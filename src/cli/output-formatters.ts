import type { AuditEvent } from '@/domain/event/audit-event';
import type { IntegrationAttempt } from '@/domain/integration/integration-attempt';
import type { DomainPackage } from '@/domain/package/domain-package';
import type { AuditEventSearchResult } from '@/domain/query/audit-event-query';
import type { CountReport } from '@/domain/query/report';
import type { Resource, ResourceReservation } from '@/domain/resource/resource';
import type { WorkItemSearchResult } from '@/domain/query/work-item-query';
import type { WorkItem } from '@/domain/work-item/work-item';
import { printJson } from './output';

export function printWorkItem(workItem: WorkItem, json = false): void {
  if (json) {
    printJson(workItem);
    return;
  }

  console.log(`${workItem.id} ${workItem.type} ${workItem.status}`);
  if (workItem.assigneeId != null) console.log(`assignee: ${workItem.assigneeId}`);
  console.log(`created: ${workItem.createdAt}`);
  console.log(`updated: ${workItem.updatedAt}`);
  if (Object.keys(workItem.fields).length > 0) {
    console.log('fields:');
    for (const [key, value] of Object.entries(workItem.fields)) {
      console.log(`  ${key}: ${formatValue(value)}`);
    }
  }
}

export function printWorkItemList(workItems: WorkItem[], json = false): void {
  if (json) {
    printJson(workItems);
    return;
  }

  if (workItems.length === 0) {
    console.log('No work items.');
    return;
  }

  for (const workItem of workItems) {
    const assignee = workItem.assigneeId != null ? ` assignee=${workItem.assigneeId}` : '';
    console.log(`${workItem.id} type=${workItem.type} status=${workItem.status}${assignee}`);
  }
}

export function printWorkItemSearchResult(result: WorkItemSearchResult, json = false): void {
  if (json) {
    printJson(result);
    return;
  }

  printWorkItemList(result.items);
  console.log(`total: ${result.total}`);
}

export function printHistory(events: AuditEvent[], json = false): void {
  if (json) {
    printJson(events);
    return;
  }

  if (events.length === 0) {
    console.log('No audit events.');
    return;
  }

  for (const event of events) {
    const subject = 'workItemId' in event ? event.workItemId : event.resourceId;
    console.log(`${event.occurredAt} ${event.type} ${subject} actor=${event.actorId}`);
  }
}

export function printAuditEventSearchResult(result: AuditEventSearchResult, json = false): void {
  if (json) {
    printJson(result);
    return;
  }

  printHistory(result.events);
  console.log(`total: ${result.total}`);
}

export function printCountReport(report: CountReport, json = false): void {
  if (json) {
    printJson(report);
    return;
  }

  if (report.counts.length === 0) {
    console.log('No matching work items.');
    return;
  }

  for (const row of report.counts) {
    console.log(`${row.value}: ${row.count}`);
  }
}

export function printDomainPackage(domainPackage: DomainPackage, json = false): void {
  if (json) {
    printJson(domainPackage);
    return;
  }

  console.log(`${domainPackage.name} workflow=${domainPackage.workflowType}`);
  if (domainPackage.lifecycle != null) {
    console.log(`lifecycle: ${domainPackage.lifecycle.status}`);
    if (domainPackage.lifecycle.replacedBy != null) {
      console.log(
        `replaced by: ${domainPackage.lifecycle.replacedBy.name}@${domainPackage.lifecycle.replacedBy.version}`
      );
    }
  }
  console.log(`registered: ${domainPackage.registeredAt}`);
  if (domainPackage.sourcePath != null) console.log(`source: ${domainPackage.sourcePath}`);
  console.log(`states: ${domainPackage.workflow.states.join(', ')}`);
  console.log(`fields: ${Object.keys(domainPackage.schema.fields).join(', ') || '(none)'}`);
  console.log(`fixtures: ${domainPackage.fixtures.join(', ') || '(none)'}`);
}

export function printDomainPackageList(domainPackages: DomainPackage[], json = false): void {
  if (json) {
    printJson(domainPackages);
    return;
  }

  if (domainPackages.length === 0) {
    console.log('No domain packages registered.');
    return;
  }

  for (const domainPackage of domainPackages) {
    console.log(`${domainPackage.name} workflow=${domainPackage.workflowType}`);
  }
}

export function printResource(resource: Resource, json = false): void {
  if (json) {
    printJson(resource);
    return;
  }

  console.log(`${resource.id} type=${resource.type}`);
  console.log(`created: ${resource.createdAt}`);
  console.log(`updated: ${resource.updatedAt}`);
  if (Object.keys(resource.fields).length > 0) {
    console.log('fields:');
    for (const [key, value] of Object.entries(resource.fields)) {
      console.log(`  ${key}: ${formatValue(value)}`);
    }
  }
}

export function printResourceList(resources: Resource[], json = false): void {
  if (json) {
    printJson(resources);
    return;
  }

  if (resources.length === 0) {
    console.log('No resources.');
    return;
  }

  for (const resource of resources) {
    console.log(`${resource.id} type=${resource.type}`);
  }
}

export function printResourceReservation(
  reservation: ResourceReservation,
  json = false
): void {
  if (json) {
    printJson(reservation);
    return;
  }

  const quantity = reservation.quantity != null ? ` quantity=${reservation.quantity}` : '';
  console.log(
    `${reservation.id} ${reservation.status} resource=${reservation.resourceId} workItem=${reservation.workItemId}${quantity}`
  );
}

export function printIntegrationAttempt(attempt: IntegrationAttempt, json = false): void {
  if (json) {
    printJson(attempt);
    return;
  }

  console.log(`${attempt.id} ${attempt.provider}/${attempt.operation} ${attempt.status}`);
  console.log(`idempotency: ${attempt.idempotencyKey}`);
  if (attempt.eventId != null) console.log(`event: ${attempt.eventId}`);
  if (attempt.workItemId != null) console.log(`work item: ${attempt.workItemId}`);
  if (attempt.resourceId != null) console.log(`resource: ${attempt.resourceId}`);
  if (attempt.externalId != null) console.log(`external: ${attempt.externalId}`);
  if (attempt.errorMessage != null) console.log(`error: ${attempt.errorMessage}`);
  console.log(`attempts: ${attempt.attemptCount}`);
  console.log(`created: ${attempt.createdAt}`);
  console.log(`updated: ${attempt.updatedAt}`);
}

export function printIntegrationAttemptList(
  attempts: IntegrationAttempt[],
  json = false
): void {
  if (json) {
    printJson(attempts);
    return;
  }

  if (attempts.length === 0) {
    console.log('No integration attempts.');
    return;
  }

  for (const attempt of attempts) {
    console.log(
      `${attempt.id} provider=${attempt.provider} operation=${attempt.operation} status=${attempt.status}`
    );
  }
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}
