import type { NormalizedWorkflowDefinition } from '@/domain/workflow/workflow-definition';
import type { WorkflowRepository } from '@/ports/workflow-repository';
import { compareStrings } from '@/primitives/string';
import { NormalizedWorkflowDefinitionSchema } from '@/validation/schemas';
import {
  filenameForId,
  listFilesRecursive,
  pathExists,
  readJson,
  safeJoin,
  type FileTempNames,
  writeJsonAtomic,
} from './fs-utils';

export class FsWorkflowRepository implements WorkflowRepository {
  private readonly root: string;

  constructor(dataDir: string, private readonly tempNames: FileTempNames) {
    this.root = safeJoin(dataDir, 'workflows');
  }

  async save(workflow: NormalizedWorkflowDefinition): Promise<void> {
    await writeJsonAtomic(this.pathFor(workflow.type), workflow, this.tempNames);
  }

  async getByType(type: string): Promise<NormalizedWorkflowDefinition | null> {
    const path = this.pathFor(type);
    if (!(await pathExists(path))) {
      return null;
    }
    return readJson<NormalizedWorkflowDefinition>(path, NormalizedWorkflowDefinitionSchema);
  }

  async list(): Promise<NormalizedWorkflowDefinition[]> {
    const files = await listFilesRecursive(this.root);
    const workflows = await Promise.all(
      files.map((file) => readJson<NormalizedWorkflowDefinition>(file, NormalizedWorkflowDefinitionSchema))
    );
    return workflows.sort((left, right) => compareStrings(left.type, right.type));
  }

  private pathFor(type: string): string {
    return safeJoin(this.root, filenameForId(type));
  }
}
