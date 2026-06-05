import type { NormalizedWorkflowDefinition } from '@/domain/workflow/workflow-definition';
import type { WorkflowRepository } from '@/ports/workflow-repository';
import { compareStrings } from '@/primitives/string';

export class InMemoryWorkflowRepository implements WorkflowRepository {
  private readonly workflows = new Map<string, NormalizedWorkflowDefinition>();

  async save(workflow: NormalizedWorkflowDefinition): Promise<void> {
    this.workflows.set(workflow.type, structuredClone(workflow));
  }

  async getByType(type: string): Promise<NormalizedWorkflowDefinition | null> {
    const workflow = this.workflows.get(type);
    return workflow == null ? null : structuredClone(workflow);
  }

  async list(): Promise<NormalizedWorkflowDefinition[]> {
    return [...this.workflows.values()]
      .map((workflow) => structuredClone(workflow))
      .sort((left, right) => compareStrings(left.type, right.type));
  }
}
