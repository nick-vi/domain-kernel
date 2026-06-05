import { ValidationError } from '@/domain/errors/domain-error';

export type Comment = {
  id: string;
  text: string;
  actorId: string;
  occurredAt: string;
};

export function createComment(input: {
  id: string;
  text: string;
  actorId: string;
  occurredAt: string;
}): Comment {
  if (input.text.trim().length === 0) {
    throw new ValidationError('Comment text is required');
  }

  return {
    id: input.id,
    text: input.text,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
  };
}
