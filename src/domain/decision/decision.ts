import { ValidationError } from '@/domain/errors/domain-error';

export type Decision = {
  id: string;
  type: string;
  reason: string;
  actorId: string;
  occurredAt: string;
};

export function createDecision(input: {
  id: string;
  type: string;
  reason: string;
  actorId: string;
  occurredAt: string;
}): Decision {
  if (input.type.trim().length === 0) {
    throw new ValidationError('Decision type is required');
  }

  if (input.reason.trim().length === 0) {
    throw new ValidationError('Decision rationale is required', { decisionType: input.type });
  }

  return {
    id: input.id,
    type: input.type,
    reason: input.reason,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
  };
}
