import type { PolicyContext, PolicyDecision } from '@/domain/policy/policy';

export interface PolicyEngine {
  evaluate(context: PolicyContext): Promise<PolicyDecision>;
}
