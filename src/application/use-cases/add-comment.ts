import { NotFoundError } from '@/domain/errors/domain-error';
import type { CommentAddedEvent } from '@/domain/event/audit-event';
import { addCommentToWorkItem, type WorkItem } from '@/domain/work-item/work-item';
import type { Actor } from '@/domain/auth/auth';
import type { ApplicationDependencies } from '@/application/dependencies';
import { authorize } from '@/application/authorization';
import { recordAuditEvent } from '@/application/audit';
import { assertExpectedVersion } from '@/application/versioning';
import { getWorkflowOrThrow } from './workflow-cache';

export type AddCommentInput = {
  workItemId: string;
  text: string;
  expectedVersion?: number | undefined;
  actor: Actor;
};

export async function addCommentUseCase(
  deps: ApplicationDependencies,
  input: AddCommentInput
): Promise<WorkItem> {
  return deps.tracer.span('addComment', { workItemId: input.workItemId }, async () => {
    authorize(deps, input.actor, 'comment:add');
    const current = await deps.workItems.getById(input.workItemId);
    if (current == null) {
      throw new NotFoundError(`Work item "${input.workItemId}" was not found`, {
        workItemId: input.workItemId,
      });
    }
    assertExpectedVersion(current, input.expectedVersion);

    const workflow = await getWorkflowOrThrow(deps, current.type);
    const occurredAt = deps.clock.now();
    const commentId = deps.ids.nextId('note');
    const updated = addCommentToWorkItem({
      workItem: current,
      workflow,
      commentId,
      text: input.text,
      actorId: input.actor.id,
      occurredAt,
    });

    const event: CommentAddedEvent = {
      id: deps.ids.nextId('evt'),
      type: 'CommentAdded',
      workItemId: updated.id,
      commentId,
      text: input.text,
      previousVersion: current.version,
      nextVersion: updated.version,
      actorId: input.actor.id,
      occurredAt,
    };

    await deps.unitOfWork.run(async () => {
      await deps.workItems.save(updated, { expectedVersion: current.version });
      await recordAuditEvent(deps, event);
    }, { name: 'addComment' });
    deps.logger.info('Comment added', { workItemId: updated.id });
    return updated;
  });
}
