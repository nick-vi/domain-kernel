import type { PolicyContext, PolicyDecision } from '@/domain/policy/policy';
import type { PolicyEngine } from '@/ports/policy-engine';

export const REVIEW_APPROVED_DECISION = 'review_approved';

export class SampleOrderReviewPolicyEngine implements PolicyEngine {
  async evaluate(context: PolicyContext): Promise<PolicyDecision> {
    if (context.workflow?.type !== 'order') return { allowed: true };
    if (context.action !== 'release') return { allowed: true };
    if (context.workItem?.fields.requiresReview !== true) return { allowed: true };

    const reviewApproved = context.workItem.decisions.some(
      (decision) => decision.type === REVIEW_APPROVED_DECISION
    );
    if (reviewApproved) return { allowed: true };

    return {
      allowed: false,
      code: 'order_review_unresolved',
      reason: 'Order review must be approved before release',
    };
  }
}
