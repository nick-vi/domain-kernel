import type { Actor } from '@/domain/auth/auth';
import type { WorkItem } from '@/domain/work-item/work-item';
import type { NormalizedWorkflowDefinition } from '@/domain/workflow/workflow-definition';

export type PolicyContext = {
  actor: Actor;
  action: string;
  workItem?: WorkItem | undefined;
  workflow?: NormalizedWorkflowDefinition | undefined;
  input?: unknown;
};

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; code: string; reason: string };
