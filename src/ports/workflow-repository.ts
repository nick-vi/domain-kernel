import type { NormalizedWorkflowDefinition } from '@/domain/workflow/workflow-definition';

export interface WorkflowRepository {
  save(workflow: NormalizedWorkflowDefinition): Promise<void>;
  getByType(type: string): Promise<NormalizedWorkflowDefinition | null>;
  list(): Promise<NormalizedWorkflowDefinition[]>;
}
